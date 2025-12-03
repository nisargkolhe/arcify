const STORAGE_KEY = 'performanceLogs';

async function loadLogs() {
    try {
        const result = await chrome.storage.local.get(STORAGE_KEY);
        const logs = result[STORAGE_KEY] || [];
        
        displayStats(logs);
        displayOperations(logs);
        displayRecentLogs(logs);
    } catch (error) {
        console.error('Error loading logs:', error);
    }
}

function displayStats(logs) {
    const statsGrid = document.getElementById('statsGrid');
    
    if (logs.length === 0) {
        statsGrid.innerHTML = '<div class="empty-state">No performance data available</div>';
        return;
    }

    const totalDuration = logs.reduce((sum, log) => sum + (log.duration || 0), 0);
    const avgDuration = totalDuration / logs.length;
    const maxDuration = Math.max(...logs.map(log => log.duration || 0));
    const minDuration = Math.min(...logs.map(log => log.duration || 0));

    // Group by label for top operations
    const labelGroups = {};
    logs.forEach(log => {
        if (!labelGroups[log.label]) {
            labelGroups[log.label] = [];
        }
        labelGroups[log.label].push(log);
    });

    const topOperations = Object.entries(labelGroups)
        .map(([label, groupLogs]) => ({
            label,
            count: groupLogs.length,
            avg: groupLogs.reduce((sum, log) => sum + (log.duration || 0), 0) / groupLogs.length,
            total: groupLogs.reduce((sum, log) => sum + (log.duration || 0), 0)
        }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 5);

    statsGrid.innerHTML = `
        <div class="stat-card">
            <div class="stat-label">Total Operations</div>
            <div class="stat-value">${logs.length}</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Avg Duration</div>
            <div class="stat-value ${getDurationClass(avgDuration)}">${avgDuration.toFixed(2)}ms</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Max Duration</div>
            <div class="stat-value ${getDurationClass(maxDuration)}">${maxDuration.toFixed(2)}ms</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Min Duration</div>
            <div class="stat-value">${minDuration.toFixed(2)}ms</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Total Time</div>
            <div class="stat-value">${totalDuration.toFixed(2)}ms</div>
        </div>
    `;
}

function displayOperations(logs) {
    const operationsBody = document.getElementById('operationsBody');
    
    if (logs.length === 0) {
        operationsBody.innerHTML = '<tr><td colspan="6" class="empty-state">No data available</td></tr>';
        return;
    }

    // Group by label
    const labelGroups = {};
    logs.forEach(log => {
        if (!labelGroups[log.label]) {
            labelGroups[log.label] = [];
        }
        labelGroups[log.label].push(log);
    });

    // Calculate stats for each label
    const operations = Object.entries(labelGroups)
        .map(([label, groupLogs]) => {
            const durations = groupLogs.map(log => log.duration || 0);
            const sum = durations.reduce((a, b) => a + b, 0);
            const avg = sum / durations.length;
            const min = Math.min(...durations);
            const max = Math.max(...durations);

            return {
                label,
                count: groupLogs.length,
                avg,
                min,
                max,
                total: sum
            };
        })
        .sort((a, b) => b.total - a.total);

    const filterValue = document.getElementById('filterInput').value.toLowerCase();
    const filteredOperations = filterValue
        ? operations.filter(op => op.label.toLowerCase().includes(filterValue))
        : operations;

    operationsBody.innerHTML = filteredOperations.map(op => `
        <tr>
            <td>${op.label}</td>
            <td>${op.count}</td>
            <td class="duration ${getDurationClass(op.avg)}">${op.avg.toFixed(2)}</td>
            <td class="duration">${op.min.toFixed(2)}</td>
            <td class="duration ${getDurationClass(op.max)}">${op.max.toFixed(2)}</td>
            <td class="duration">${op.total.toFixed(2)}</td>
        </tr>
    `).join('');
}

function displayRecentLogs(logs) {
    const recentLogsBody = document.getElementById('recentLogsBody');
    
    if (logs.length === 0) {
        recentLogsBody.innerHTML = '<tr><td colspan="4" class="empty-state">No data available</td></tr>';
        return;
    }

    // Show last 50 logs
    const recentLogs = logs.slice(-50).reverse();

    recentLogsBody.innerHTML = recentLogs.map(log => {
        const date = new Date(log.timestamp || log.endTimestamp || Date.now());
        const timeStr = date.toLocaleTimeString();
        const metadata = log.error ? `Error: ${log.error}` : 
                       log.resultCount ? `Results: ${log.resultCount}` :
                       log.spaceCount ? `Spaces: ${log.spaceCount}` :
                       log.query ? `Query: ${log.query}` : '';

        return `
            <tr>
                <td>${timeStr}</td>
                <td>${log.label}</td>
                <td class="duration ${getDurationClass(log.duration)}">${(log.duration || 0).toFixed(2)}</td>
                <td>${metadata}</td>
            </tr>
        `;
    }).join('');
}

function getDurationClass(duration) {
    if (duration < 50) return 'fast';
    if (duration < 200) return 'medium';
    return 'slow';
}

async function clearLogs() {
    if (confirm('Are you sure you want to clear all performance logs?')) {
        await chrome.storage.local.remove(STORAGE_KEY);
        loadLogs();
    }
}

async function exportLogs() {
    try {
        const result = await chrome.storage.local.get(STORAGE_KEY);
        const logs = result[STORAGE_KEY] || [];
        
        const dataStr = JSON.stringify(logs, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        
        const link = document.createElement('a');
        link.href = url;
        link.download = `arcify-performance-logs-${Date.now()}.json`;
        link.click();
        
        URL.revokeObjectURL(url);
    } catch (error) {
        console.error('Error exporting logs:', error);
        alert('Error exporting logs: ' + error.message);
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    // Set up button event listeners
    document.getElementById('refreshBtn').addEventListener('click', loadLogs);
    document.getElementById('clearBtn').addEventListener('click', clearLogs);
    document.getElementById('exportBtn').addEventListener('click', exportLogs);

    // Filter input handler
    document.getElementById('filterInput').addEventListener('input', () => {
        loadLogs();
    });

    // Load logs on page load
    loadLogs();

    // Auto-refresh every 5 seconds
    setInterval(loadLogs, 5000);
});

