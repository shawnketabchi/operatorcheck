let allResults = [];
let originalNumbers = [];

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

async function lookupNumbers() {
    const button = document.querySelector('button');
    const input = document.getElementById("phoneNumbers").value.trim();
    const resultsDiv = document.getElementById("results");

    if (!input) {
        showError(resultsDiv, "Please enter at least one number.");
        return;
    }

    if (!input.includes(',') && input.length > 15) {
        showError(resultsDiv, "Numbers must be comma-separated");
        return;
    }

    const numbers = input.split(",").map(num => num.trim()).filter(Boolean);
    const validationResults = numbers.map(num => ({
        number: num,
        ...validateNumber(num)
    }));

    const invalidNumbers = validationResults.filter(result => !result.valid);
    
    if (invalidNumbers.length > 0) {
        showError(resultsDiv, `Invalid number format:<br>${invalidNumbers
            .map(result => `"${result.number}": ${result.error}`)
            .join('<br>')}`);
        return;
    }

    setLoading(true, button);
    originalNumbers = numbers;

    try {
        await processNumbers(numbers, resultsDiv);
    } catch (error) {
        showError(resultsDiv, error.message);
    } finally {
        setLoading(false, button);
    }
}

async function processNumbers(numbers, resultsDiv) {
    const formattedNumbers = numbers.map(formatNumber);
    allResults = [];

    for (let i = 0; i < formattedNumbers.length; i += 2000) {
        const chunk = formattedNumbers.slice(i, i + 2000);
        const data = await fetchOperators(chunk);
        allResults.push(...data);
    }

    if (!allResults.length) {
        resultsDiv.innerHTML = "<p>No data found.</p>";
        resultsDiv.classList.remove("hidden");
        return;
    }

    updateResults(resultsDiv);
}

function updateResults(resultsDiv) {
    const resultMap = Object.fromEntries(allResults.map(entry => [entry.number, entry.name]));
    
    resultsDiv.innerHTML = `
        <div class="results-header">
            <div class="results-info">
                <h3>Results</h3>
                <span class="results-count">${allResults.length} numbers</span>
            </div>
            <div class="results-actions">
                <span class="material-symbols-outlined" onclick="copyResults()" title="Copy">content_copy</span>
                <span class="material-symbols-outlined" onclick="downloadResults()" title="Download">download</span>
            </div>
        </div>
        <ul>${originalNumbers.map(num => 
            `<li>${num} - ${resultMap[formatNumber(num)] || "Unknown Operator"}</li>`
        ).join('')}</ul>`;
    
    resultsDiv.classList.remove("hidden");
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

function downloadResults() {
    if (allResults.length === 0) return;

    const text = originalNumbers.map(num => {
        const formatted = formatNumber(num);
        const operator = allResults.find(entry => entry.number === formatted)?.name || "Unknown Operator";
        return `${num} - ${operator}`;
    }).join("\n");

    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "phone_lookup_results.txt";
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
    const textarea = document.getElementById('phoneNumbers');
    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            lookupNumbers();
        }
    });
});