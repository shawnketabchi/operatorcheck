let allResults = [];
let originalNumbers = [];
let activeFilter = null;

function formatNumber(num) {
    num = num.replace(/\s+/g, "");
    if (num.startsWith("+46")) num = "0" + num.slice(3);

    const patterns = [
        { regex: /^(08)(\d{7})$/, format: "$1-$2" },
        { regex: /^(0\d{2})(\d{5,7})$/, format: "$1-$2" },
        { regex: /^(0\d{3})(\d{4,6})$/, format: "$1-$2" }
    ];

    for (const pattern of patterns) {
        if (pattern.regex.test(num)) return num.replace(pattern.regex, pattern.format);
    }
    return num;
}

function validateNumber(num) {
    if (!num) return { valid: false, error: 'Empty input' };
    
    num = num.replace(/\s+/g, "");
    
    if (!/^(\+46|0)\d+$/.test(num)) {
        return { 
            valid: false, 
            error: 'Must start with +46 or 0, followed by digits only' 
        };
    }

    const normalized = num.startsWith('+46') ? '0' + num.slice(3) : num;

    if (!/^(08\d{7}|0\d{2}\d{5,7}|0\d{3}\d{4,6})$/.test(normalized)) {
        return { 
            valid: false, 
            error: 'Invalid length or format' 
        };
    }

    return { valid: true };
}

function escapeHtml(str) {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

async function lookupNumbers() {
    const button = document.getElementById("lookup-btn");
    const input = document.getElementById("phoneNumbers").value.trim();
    const resultsDiv = document.getElementById("results");

    if (!input) {
        showError(resultsDiv, "Please enter at least one number.");
        return;
    }

    const rawNumbers = input.split(/[\n,]+/).map(num => num.trim()).filter(Boolean);
    const unique = [...new Set(rawNumbers)];
    const validationResults = unique.map(num => ({
        number: num,
        ...validateNumber(num)
    }));

    const invalidNumbers = validationResults.filter(result => !result.valid);

    if (invalidNumbers.length > 0) {
        showError(resultsDiv, `Invalid number format:<br>${invalidNumbers
            .map(result => `"${escapeHtml(result.number)}": ${escapeHtml(result.error)}`)
            .join('<br>')}`);
        return;
    }

    setLoading(true, button);
    originalNumbers = unique;

    try {
        await processNumbers(unique, resultsDiv, button);
    } catch (error) {
        showError(resultsDiv, error.message);
    } finally {
        setLoading(false, button);
    }
}

async function processNumbers(numbers, resultsDiv, button) {
    const formattedNumbers = numbers.map(formatNumber);
    allResults = [];
    activeFilter = null;

    const totalChunks = Math.ceil(formattedNumbers.length / 2000);
    for (let i = 0; i < formattedNumbers.length; i += 2000) {
        if (totalChunks > 1) {
            const batchNum = i / 2000 + 1;
            button.querySelector('.loading-text').textContent = `Batch ${batchNum} / ${totalChunks}…`;
        }
        const chunk = formattedNumbers.slice(i, i + 2000);
        allResults.push(...await fetchOperators(chunk));
    }

    if (!allResults.length) {
        resultsDiv.innerHTML = "<p>No data found.</p>";
        resultsDiv.classList.remove("hidden");
        return;
    }

    updateResults(resultsDiv);
}

function buildOperatorCounts() {
    const counts = {};
    for (const entry of allResults) {
        const name = entry.name || "Unknown Operator";
        counts[name] = (counts[name] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

function updateResults(resultsDiv) {
    const operatorCounts = buildOperatorCounts();
    const breakdownHtml = operatorCounts
        .map(([name, count]) => `<span class="operator-tag" data-operator="${escapeHtml(name)}"><span class="operator-count">${count}</span> ${escapeHtml(name)}</span>`)
        .join('');

    resultsDiv.innerHTML = `
        <div class="results-header">
            <div class="results-info">
                <h3>Results</h3>
                <span class="results-count">${allResults.length} numbers</span>
            </div>
            <div class="results-actions">
                <span class="material-symbols-outlined" onclick="copyResults()" title="Copy">content_copy</span>
                <span class="material-symbols-outlined" onclick="downloadResultsCsv()" title="Download CSV">download</span>
            </div>
        </div>
        <div class="operator-breakdown">${breakdownHtml}</div>
        <ul></ul>`;

    resultsDiv.querySelectorAll('.operator-tag').forEach(tag => {
        tag.addEventListener('click', () => filterByOperator(tag.dataset.operator));
    });

    renderList(resultsDiv);
    resultsDiv.classList.remove("hidden");
}

function filterByOperator(name) {
    activeFilter = activeFilter === name ? null : name;
    renderList(document.getElementById('results'));
}

function renderList(resultsDiv) {
    const resultMap = Object.fromEntries(allResults.map(e => [e.number, e.name]));
    const visible = activeFilter
        ? originalNumbers.filter(num => (resultMap[formatNumber(num)] || "Unknown Operator") === activeFilter)
        : originalNumbers;

    resultsDiv.querySelector('ul').innerHTML = visible
        .map(num => `<li>${num} - ${resultMap[formatNumber(num)] || "Unknown Operator"}</li>`)
        .join('');

    let hint = resultsDiv.querySelector('.filter-hint');
    if (activeFilter) {
        if (!hint) {
            hint = document.createElement('p');
            hint.className = 'filter-hint';
            resultsDiv.querySelector('ul').after(hint);
        }
        hint.textContent = `Showing ${visible.length} of ${originalNumbers.length} numbers`;
    } else if (hint) {
        hint.remove();
    }

    resultsDiv.querySelectorAll('.operator-tag').forEach(tag => {
        tag.classList.toggle('active', tag.dataset.operator === activeFilter);
    });
}

function copyResults() {
    if (allResults.length === 0) return;

    const text = originalNumbers.map(num => {
        const formatted = formatNumber(num);
        const operator = allResults.find(entry => entry.number === formatted)?.name || "Unknown Operator";
        return `${num} - ${operator}`;
    }).join("\n");

    navigator.clipboard.writeText(text)
    .then(() => {
        const copyIcon = document.querySelector('.material-symbols-outlined[title="Copy"]');
        copyIcon.textContent = 'check';
        setTimeout(() => {
            copyIcon.textContent = 'content_copy';
        }, 2000);
    })
    .catch(err => {
        console.error("Failed to copy:", err);
        showError(document.getElementById('results'), "Failed to copy to clipboard");
    });
}


function downloadResultsCsv() {
    if (allResults.length === 0) return;

    const rows = ["Number,Operator"];
    originalNumbers.forEach(num => {
        const formatted = formatNumber(num);
        const operator = allResults.find(entry => entry.number === formatted)?.name || "Unknown Operator";
        rows.push(`${num},${operator}`);
    });

    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "operatorcheck.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function setLoading(isLoading, button) {
    button.classList.toggle('loading', isLoading);
    button.disabled = isLoading;
    button.innerHTML = isLoading ? 
        '<span class="material-symbols-outlined">sync</span><span class="loading-text">Looking up...</span>' : 
        '<span class="button-text">Lookup</span>';
}

function showError(resultsDiv, message) {
    resultsDiv.innerHTML = `<div style="text-align: center;"><p class="error-message">Error: ${message}</p></div>`;
    resultsDiv.classList.remove("hidden");
}

async function fetchOperators(numbers) {
    try {
        const response = await fetch("https://operatorcheck.shawnketabchi.workers.dev/", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(numbers)
        });

        if (response.status === 429) {
            throw new Error("Too many requests. Please wait a moment and try again.");
        }

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API request failed: ${errorText}`);
        }

        return response.json();
    } catch (error) {
        if (error.name === 'AbortError') {
            throw new Error('Request timed out. Please try again.');
        }
        throw error;
    }
}

window.addEventListener('unhandledrejection', event => {
    console.error('Unhandled promise rejection:', event.reason);
    showError(document.getElementById('results'), 'An unexpected error occurred. Please try again.');
});

document.addEventListener('DOMContentLoaded', () => {
    const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
    document.getElementById('keyboard-hint').textContent =
        `Press ${isMac ? '⌘' : 'Ctrl'}+Enter to lookup numbers`;

    document.getElementById('phoneNumbers').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            lookupNumbers();
        }
    });

    document.querySelectorAll('.results-actions .material-symbols-outlined').forEach(el => {
        el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                el.click();
            }
        });
    });

    // Theme toggle
    const html = document.documentElement;
    const themeIcon = document.getElementById('theme-icon');

    function applyTheme(theme) {
        html.setAttribute('data-theme', theme);
        themeIcon.textContent = theme === 'dark' ? 'light_mode' : 'dark_mode';
        localStorage.setItem('theme', theme);
    }

    const savedTheme = localStorage.getItem('theme') || 'dark';
    applyTheme(savedTheme);

    document.getElementById('theme-toggle').addEventListener('click', () => {
        const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        applyTheme(next);
    });
});