// Visualization & Reporting
// DOM manipulation, Chart.js rendering

import { runSimulation, computeRequiredMinimums, compareStrategies } from './engine.js';
import { serializeToURL, gatherStateFromDOM, restoreStateToDOM, deserializeFromURL } from './state.js';

let chart = null;
let costChart = null;

function debounce(func, delay) {
    let timeout;
    return function(...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), delay);
    };
}

function initChart() {
    const ctx = document.getElementById('debt-chart').getContext('2d');
    chart = new Chart(ctx, {
        type: 'line',
        data: { datasets: [] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                },
            },
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: { grid: { display: true } }, // Keep grid lines for x-axis
                y: { grid: { display: true } }, // Keep grid lines for y-axis
            },
            elements: {
                point: { radius: 0 }, // Remove points from the chart
            },
        },
    });

    const costCtx = document.getElementById('cost-breakdown-chart').getContext('2d');
    costChart = new Chart(costCtx, {
        type: 'doughnut',
        data: { labels: [], datasets: [] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed !== null) {
                                label += new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(context.parsed);
                            }
                            return label;
                        }
                    }
                }
            }
        }
    });

}

function updateChart(simResults) {
    if (!chart || !costChart) return;
    if (!simResults || !simResults.months) {
        chart.data.labels = [];
        chart.data.datasets = [];
        chart.update();

        costChart.data.labels = [];
        costChart.data.datasets = [];
        costChart.update();
        document.getElementById('cost-breakdown-stats').innerHTML = '';
        return;
    }
    const months = simResults.months.map(m => m.label || `M${m.month}`);
    // One dataset for total
    const totalData = simResults.months.map(m => Number(m.closingTotal.toFixed(2)));
    chart.data.labels = months;
    // Build per-group series
    const groupMap = {};
    simResults.months.forEach(month => {
        month.segments.forEach(s => {
            const g = s.groupName || s.groupId || 'Other';
            groupMap[g] = groupMap[g] || [];
        });
    });

    const existingDatasets = chart.data.datasets;
    const newDatasets = [];

    Object.keys(groupMap).forEach((gName, gi) => {
        const data = simResults.months.map(m => {
            const groupTotal = m.segments.filter(s=>s.groupName===gName).reduce((acc,s)=>acc + Number(s.balance||0), 0);
            return Number(groupTotal.toFixed(2));
        });
        const color = `hsl(${(gi*70)%360} 70% 50%)`;
        const existingDs = existingDatasets.find(ds => ds.label === gName);
        newDatasets.push({ 
            label: gName, 
            data, 
            borderColor: color, 
            fill: false,
            hidden: existingDs ? existingDs.hidden : false 
        });
    });
    // total last
    const existingTotalDs = existingDatasets.find(ds => ds.label === 'Total Debt');
    newDatasets.push({ 
        label: 'Total Debt', 
        data: totalData, 
        borderColor: '#ef4444', 
        borderWidth: 2, 
        fill: false,
        hidden: existingTotalDs ? existingTotalDs.hidden : false
    });
    chart.data.datasets = newDatasets;
    chart.update('none');

    // Update Cost Chart
    const principal = simResults.initialBalance || 0;
    const interest = simResults.totalInterest || 0;
    const fees = simResults.totalFees || 0;
    const totalCost = interest + fees;
    const totalPaid = principal + totalCost;

    costChart.data.labels = ['Principal', 'Interest', 'Fees'];
    costChart.data.datasets = [{
        data: [principal, interest, fees],
        backgroundColor: [
            '#3b82f6', // blue-500
            '#ef4444', // red-500
            '#f59e0b'  // amber-500
        ],
        hoverOffset: 4
    }];
    costChart.update('none');

    // Update stats text
    const pctCost = totalPaid > 0 ? (totalCost / totalPaid * 100).toFixed(1) : '0.0';
    document.getElementById('cost-breakdown-stats').innerHTML = `
        <div class="font-bold">Total Payoff: ${formatCurrency(totalPaid)}</div>
        <div class="text-xs text-red-500">Wasted: ${formatCurrency(totalCost)} (${pctCost}%)</div>
    `;
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount);
}

function downloadCSV(simResults) {
    if (!simResults || !simResults.months) return;

    // Helper to escape CSV fields
    const esc = (text) => {
        const str = String(text);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
    };

    const rows = [['Month', 'Category', 'Description', 'Payment', 'Balance']];

    simResults.months.forEach(m => {
        // Summary Row
        const monthLabel = m.label ? m.label : `Month ${m.month}`;
        let summaryDesc = `Total Interest: ${m.interest.toFixed(2)}`;
        if (m.windfall > 0) summaryDesc += ` | Windfall: +${m.windfall.toFixed(2)}`;
        rows.push([monthLabel, 'Summary', esc(summaryDesc), '', m.closingTotal.toFixed(2)]);

        // BT Actions
        if (m.btActions) {
            m.btActions.forEach(bt => {
                const desc = `Transfer ${bt.amount.toFixed(2)} from ${bt.sourceCard} to ${bt.destinationCard} (Fee: ${bt.fee.toFixed(2)})`;
                rows.push([
                    monthLabel, 
                    'Balance Transfer', 
                    esc(desc), 
                    '', 
                    bt.newBalance.toFixed(2)
                ]);
            });
        }

        // Aggregate by Group for simple reporting
        const groups = {};
        const allSegmentIds = new Set([...m.openingSegments.map(s => s.id), ...m.segments.map(s => s.id)]);

        allSegmentIds.forEach(id => {
            const openingSeg = m.openingSegments.find(s => s.id === id);
            const closingSeg = m.segments.find(s => s.id === id);
            const segInfo = openingSeg || closingSeg;
            if (!segInfo) return;

            const gName = segInfo.groupName || 'Other';
            if (!groups[gName]) groups[gName] = { totalPayment: 0, totalBalance: 0 };

            const minPaid = Number(m.payments[id]?.minPaid || 0);
            const extraPaid = Number(m.payments[id]?.extraPaid || 0);
            groups[gName].totalPayment += minPaid + extraPaid;
            groups[gName].totalBalance += Number(closingSeg?.balance || 0);
        });

        Object.keys(groups).forEach(gName => {
            const g = groups[gName];
            if (g.totalPayment > 0.005 || g.totalBalance > 0.005) {
                rows.push([monthLabel, esc(gName), 'Monthly Payment', g.totalPayment.toFixed(2), g.totalBalance.toFixed(2)]);
            }
        });
    });

    const csvContent = rows.map(e => e.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "debt_repayment_plan.csv");
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function renderReport(simResults) {
    const section = document.getElementById('report-section');
    const tbody = document.getElementById('report-table-body');
    const payoffDisplay = document.getElementById('payoff-date-display');
    const interestDisplay = document.getElementById('total-interest-display');
    if (!simResults || !simResults.months) {
        section.classList.add('hidden');
        return;
    }
    section.classList.remove('hidden');
    tbody.innerHTML = '';
    
    simResults.months.forEach(m => {
        const header = document.createElement('tr');
        header.className = 'bg-slate-50 dark:bg-slate-700';
        const dateDisplay = m.label ? `${m.label} (M${m.month})` : `Month ${m.month}`;
        
        let headerContent = `<td class="p-3 font-bold">${dateDisplay}</td><td class="p-3" colspan="2">Total Interest: ${formatCurrency(m.interest)}`;
        if (m.windfall > 0) {
            headerContent += ` <span class="text-green-500 font-bold">(+${formatCurrency(m.windfall)} windfall)</span>`;
        }
        headerContent += `</td><td class="p-3 text-right">Closing Total: ${formatCurrency(m.closingTotal)}</td>`;
        header.innerHTML = headerContent;
        tbody.appendChild(header);
        
        // Display BT Actions for the month
        if (m.btActions && m.btActions.length > 0) {
            const btRow = document.createElement('tr');
            btRow.className = 'bg-indigo-50 dark:bg-indigo-900/50';
            let btHtml = '<td class="p-3 text-sm" colspan="4"><div class="font-bold text-indigo-600 dark:text-indigo-400">Balance Transfer Actions:</div><ul class="list-disc pl-5">';
            
            // Consolidate BT actions by source card and destination
            const consolidatedActions = {};
            m.btActions.forEach(action => {
                const key = `${action.sourceCard}|${action.destinationCard}`;
                if (!consolidatedActions[key]) {
                    consolidatedActions[key] = {
                        sourceCard: action.sourceCard,
                        destinationCard: action.destinationCard,
                        totalAmount: 0,
                        totalFee: 0,
                        totalNewBalance: 0
                    };
                }
                consolidatedActions[key].totalAmount += action.amount;
                consolidatedActions[key].totalFee += action.fee;
                consolidatedActions[key].totalNewBalance += action.newBalance;
            });

            Object.values(consolidatedActions).forEach(action => {
                btHtml += `<li>Transfer ${formatCurrency(action.totalAmount)} from ${action.sourceCard} to ${action.destinationCard}. New balance on BT card: ${formatCurrency(action.totalNewBalance)} (incl. ${formatCurrency(action.totalFee)} fee).</li>`;
            });
            
            btHtml += '</ul></td>';
            btRow.innerHTML = btHtml;
            tbody.appendChild(btRow);
        }

        // A more robust way to group monthly data
        const groups = {};

        // Consolidate all unique segments from both opening and closing
        const allSegmentIds = new Set([...m.openingSegments.map(s => s.id), ...m.segments.map(s => s.id)]);

        allSegmentIds.forEach(id => {
            const openingSeg = m.openingSegments.find(s => s.id === id);
            const closingSeg = m.segments.find(s => s.id === id);
            const segInfo = openingSeg || closingSeg;
            if (!segInfo) return;

            const gName = segInfo.groupName || segInfo.groupId || 'Other';
            if (!groups[gName]) {
                groups[gName] = { opening: 0, min: 0, extra: 0, interest: 0, closing: 0, totalPayment: 0 };
            }

            const minPaid = Number(m.payments[id]?.minPaid || 0);
            const extraPaid = Number(m.payments[id]?.extraPaid || 0);

            groups[gName].opening += Number(openingSeg?.openingBalance || 0);
            groups[gName].interest += Number(openingSeg?.interest || 0);
            groups[gName].min += minPaid;
            groups[gName].extra += extraPaid;
            groups[gName].totalPayment += minPaid + extraPaid;
            groups[gName].closing += Number(closingSeg?.balance || 0);
        });

        Object.keys(groups).forEach(gName => {
            const g = groups[gName];
            // Only show groups that were active this month
            if (g.opening < 0.01 && g.closing < 0.01 && g.totalPayment < 0.01) return;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="p-3 pl-6">${gName}</td>
                <td class="p-3">
                    <div class="font-bold text-lg">${formatCurrency(g.totalPayment)}</div>
                    <div class="text-xs text-slate-500">Min: ${formatCurrency(g.min)} | Extra: ${formatCurrency(g.extra)}</div>
                </td>
                <td class="p-3 text-right">Interest: ${formatCurrency(g.interest)}</td>
                <td class="p-3 text-right">Closing: ${formatCurrency(g.closing)}</td>
            `;
            tbody.appendChild(tr);
        });
    });
    payoffDisplay.textContent = simResults.payoffMonth ? `${simResults.payoffMonth} months` : 'N/A';
    interestDisplay.textContent = `${formatCurrency(simResults.totalInterest)}`;

    const csvBtn = document.getElementById('export-csv-btn');
    if (csvBtn) {
        // Clone to clear listeners
        const newBtn = csvBtn.cloneNode(true);
        csvBtn.parentNode.replaceChild(newBtn, csvBtn);
        newBtn.addEventListener('click', () => downloadCSV(simResults));
    }
}

function validateBudgetAndToggleWarning() {
    const state = gatherStateFromDOM();
    const requiredMin = computeRequiredMinimums(state);
    const budgetEl = document.getElementById('monthly-budget');
    const sliderEl = document.getElementById('monthly-budget-slider');
    const warnEl = document.getElementById('budget-warning');

    // Update Slider
    if (sliderEl) {
        // Enforce min on slider so dragging always yields valid budget
        sliderEl.min = Math.ceil(requiredMin);
        // Ensure max is sufficient
        const desiredMax = Math.max(5000, Math.ceil(requiredMin * 3));
        if (Number(sliderEl.max) !== desiredMax) {
            sliderEl.max = desiredMax;
        }
        // Keep visual slider in sync with text input
        if (document.activeElement !== sliderEl) {
             sliderEl.value = budgetEl.value;
        }
    }

    const budget = Number(budgetEl.value) || 0;
    if (budget < requiredMin - 0.0001) {
        budgetEl.classList.add('budget-error');
        warnEl.classList.remove('hidden');
        document.getElementById('min-pay-total').textContent = requiredMin.toFixed(2);
        return false;
    }
    budgetEl.classList.remove('budget-error');
    warnEl.classList.add('hidden');
    return true;
}

function setupWindfallElement(el, debouncedUpdate) {
    el.querySelector('.remove-windfall').addEventListener('click', () => {
        el.remove();
        debouncedUpdate();
    });
    el.querySelectorAll('input').forEach(inp => inp.addEventListener('input', debouncedUpdate));
}

function setupBtElement(el, debouncedUpdate) {
    el.querySelector('.remove-bt').addEventListener('click', () => {
        el.remove();
        debouncedUpdate();
    });
    el.querySelectorAll('input').forEach(inp => inp.addEventListener('input', debouncedUpdate));
    // Specifically listen for change on the toggle
    const toggle = el.querySelector('.bt-enabled');
    if (toggle) {
        toggle.addEventListener('change', debouncedUpdate);
    }
}

function updateGroupSummary(groupEl) {
    const balanceSpans = groupEl.querySelectorAll('.segment-balance');
    let totalBalance = 0;
    balanceSpans.forEach(span => {
        totalBalance += Number(span.value) || 0;
    });
    const summaryEl = groupEl.querySelector('.total-balance');
    if (summaryEl) {
        summaryEl.textContent = `${formatCurrency(totalBalance)}`;
    }
}

function wireControls(debouncedUpdate) {
    // Help/Instructions toggle
    const helpBtn = document.getElementById('toggle-help-btn');
    const instructionsPanel = document.getElementById('instructions-panel');
    const closeInstructionsBtn = document.getElementById('close-instructions-btn');

    if (helpBtn && instructionsPanel) {
        
        const toggleInstructions = (show) => {
            if (show === undefined) {
                 show = instructionsPanel.classList.contains('hidden');
            }
            instructionsPanel.classList.toggle('hidden', !show);
        };

        helpBtn.addEventListener('click', () => toggleInstructions());
        
        if (closeInstructionsBtn) {
            closeInstructionsBtn.addEventListener('click', () => toggleInstructions(false));
        }

        // Context Help Buttons
        document.querySelectorAll('.context-help-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                // 1. Show Instructions Panel
                toggleInstructions(true);
                
                // 2. Open the secondary details element
                const extraDetails = document.getElementById('instructions-extras');
                if (extraDetails) {
                    extraDetails.open = true;
                }

                // 3. Scroll to target
                const targetId = btn.dataset.target;
                if (targetId) {
                    const targetEl = document.getElementById(targetId);
                    if (targetEl) {
                        setTimeout(() => {
                            targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            // Highlight effect
                            targetEl.classList.add('text-indigo-600', 'dark:text-indigo-400', 'transition-colors', 'duration-1000');
                            setTimeout(() => {
                                targetEl.classList.remove('text-indigo-600', 'dark:text-indigo-400');
                            }, 2000);
                        }, 100); // slight delay to allow details expansion
                    }
                }
            });
        });
    }

    // View Disclaimer Link (Scroll to footer)
    const viewDisclaimerBtn = document.getElementById('view-disclaimer-link');
    if (viewDisclaimerBtn) {
        viewDisclaimerBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const footer = document.getElementById('disclaimer');
            if (footer) {
                footer.scrollIntoView({ behavior: 'smooth' });
            }
        });
    }

    // Share Buttons
    const shareConfigBtn = document.getElementById('share-config-btn');
    if (shareConfigBtn) {
        shareConfigBtn.addEventListener('click', () => {
             navigator.clipboard.writeText(window.location.href).then(() => {
                const originalText = shareConfigBtn.innerHTML;
                shareConfigBtn.innerHTML = `<span class="text-green-600 dark:text-green-400 font-bold">Copied!</span>`;
                setTimeout(() => { shareConfigBtn.innerHTML = originalText; }, 2000);
             });
        });
    }

    const shareCleanBtn = document.getElementById('share-clean-btn');
    if (shareCleanBtn) {
        shareCleanBtn.addEventListener('click', () => {
             const cleanUrl = window.location.origin + window.location.pathname;
             navigator.clipboard.writeText(cleanUrl).then(() => {
                const originalText = shareCleanBtn.innerHTML;
                shareCleanBtn.innerHTML = `<span class="text-green-600 dark:text-green-400 font-bold">Copied!</span>`;
                setTimeout(() => { shareCleanBtn.innerHTML = originalText; }, 2000);
             });
        });
    }
    
    const calendarModeEl = document.getElementById('use-calendar-mode');
    if (calendarModeEl) {
        calendarModeEl.addEventListener('change', debouncedUpdate);
    }

    // Extract Scenario Button
    const extractBtn = document.getElementById('extract-scenario-btn');
    if (extractBtn) {
        extractBtn.addEventListener('click', () => {
            const state = gatherStateFromDOM();
            // Don't need dark mode in scenario test data usually
            delete state.darkMode; 
            const json = JSON.stringify(state, null, 4);
            
            navigator.clipboard.writeText(json).then(() => {
                const originalText = extractBtn.innerHTML;
                extractBtn.innerHTML = `<span class="font-bold">JSON Copied!</span>`;
                console.log('Scenario JSON:', json);
                setTimeout(() => { extractBtn.innerHTML = originalText; }, 2000);
            });
        });
    }

    // Dark mode toggle
    const dm = document.getElementById('dark-mode-toggle');
    dm.addEventListener('click', () => {
        document.documentElement.classList.toggle('dark');
        // toggle text
        dm.textContent = document.documentElement.classList.contains('dark') ? 'Running in Dark Mode' : 'Running in Light Mode';
        const state = gatherStateFromDOM();
        state.darkMode = document.documentElement.classList.contains('dark');
        serializeToURL(state);
    });

    // Collapse Debts Section
    const toggleBtn = document.getElementById('toggle-debts-btn');
    
    toggleBtn.addEventListener('click', () => {
        const debtsContainer = document.getElementById('debts-container');
        const allGroups = debtsContainer.querySelectorAll('.group-item');
        const isCollapsing = toggleBtn.textContent.includes('Collapse');

        allGroups.forEach(groupEl => {
            const body = groupEl.querySelector('.group-body');
            const summary = groupEl.querySelector('.total-balance');
            const toggleButton = groupEl.querySelector('.toggle-group-details');
            const removeBtn = groupEl.querySelector('.remove-group');
            const groupNameInput = groupEl.querySelector('.group-name');
            const groupNameText = groupEl.querySelector('.group-name-text');
            
            body.classList.toggle('hidden', isCollapsing);
            summary.classList.toggle('hidden', !isCollapsing);
            removeBtn.classList.toggle('hidden', isCollapsing);
            groupNameInput.classList.toggle('hidden', isCollapsing);
            groupNameText.classList.toggle('hidden', !isCollapsing);
            groupNameText.textContent = groupNameInput.value;
            toggleButton.textContent = isCollapsing ? 'Expand' : 'Collapse';
            if(isCollapsing) {
                updateGroupSummary(groupEl);
            }
        });

        toggleBtn.textContent = isCollapsing ? 'Expand All' : 'Collapse All';
    });

    // Add group
    document.getElementById('add-group-btn').addEventListener('click', () => {
        const tpl = document.getElementById('group-template');
        const clone = tpl.content.cloneNode(true);
        const el = clone.querySelector('.group-item');
        setupGroupElement(el, debouncedUpdate);
        document.getElementById('debts-container').appendChild(el);
        
        // Automatically add the first segment so it's visible immediately
        el.querySelector('.add-segment-btn').click();
        
        debouncedUpdate();
    });

    // Add windfall
    document.getElementById('add-windfall-btn').addEventListener('click', () => {
        const container = document.getElementById('windfalls-container');
        const div = document.createElement('div');
        div.className = 'windfall-item bg-white dark:bg-slate-850 p-3 rounded-lg shadow-sm relative';
        div.innerHTML = `
            <button class="remove-windfall absolute top-2 right-2 text-slate-400 hover:text-red-500 text-lg">&times;</button>
            <div class="grid grid-cols-2 gap-3">
                <div>
                    <label class="block text-[10px] font-bold uppercase text-slate-500 mb-1">Month</label>
                    <input type="number" class="windfall-month w-full p-1 text-sm border border-slate-300 rounded dark:bg-slate-700 dark:border-slate-600" placeholder="e.g. 3">
                </div>
                <div>
                    <label class="block text-[10px] font-bold uppercase text-slate-500 mb-1">Amount</label>
                    <input type="number" class="windfall-amount w-full p-1 text-sm border border-slate-300 rounded dark:bg-slate-700 dark:border-slate-600" placeholder="e.g. 500">
                </div>
            </div>
        `;
        setupWindfallElement(div, debouncedUpdate);
        container.appendChild(div);
        debouncedUpdate();
    });

    // Add BT offer
    document.getElementById('add-bt-btn').addEventListener('click', ()=>{
        const container = document.getElementById('bt-offers-container');
        const id = Date.now();
        const div = document.createElement('div');
        div.className = 'bt-item bg-white dark:bg-slate-850 p-3 rounded-lg shadow-sm relative';
        div.dataset.btId = id;
        div.innerHTML = `
            <div class="flex justify-between items-center mb-2">
                <input type="text" class="bt-name flex-grow p-1 text-sm font-semibold border border-transparent rounded dark:bg-slate-850 dark:border-transparent focus:border-slate-300 dark:focus:border-slate-600 mr-2" placeholder="e.g. New Card Offer">
                <div class="flex items-center space-x-2">
                    <label class="flex items-center cursor-pointer">
                        <input type="checkbox" class="bt-enabled sr-only peer" checked>
                        <div class="relative w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 dark:peer-focus:ring-indigo-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-indigo-600"></div>
                    </label>
                    <button class="remove-bt text-slate-400 hover:text-red-500 text-lg">&times;</button>
                </div>
            </div>
            <div class="grid grid-cols-3 gap-2">
                <div>
                    <label class="block text-[10px] font-bold uppercase text-slate-500 mb-1">Cap</label>
                    <input type="number" class="bt-cap w-full p-1 text-sm border border-slate-300 rounded dark:bg-slate-700 dark:border-slate-600" placeholder="5000">
                </div>
                <div>
                    <label class="block text-[10px] font-bold uppercase text-slate-500 mb-1">Fee %</label>
                    <input type="number" class="bt-fee w-full p-1 text-sm border border-slate-300 rounded dark:bg-slate-700 dark:border-slate-600" placeholder="3">
                </div>
                <div>
                    <label class="block text-[10px] font-bold uppercase text-slate-500 mb-1">Promo APR</label>
                    <input type="number" class="bt-promo-apr w-full p-1 text-sm border border-slate-300 rounded dark:bg-slate-700 dark:border-slate-600" placeholder="0">
                </div>
                <div>
                    <label class="block text-[10px] font-bold uppercase text-slate-500 mb-1">Months</label>
                    <input type="number" class="bt-months w-full p-1 text-sm border border-slate-300 rounded dark:bg-slate-700 dark:border-slate-600" placeholder="12">
                </div>
                <div>
                    <label class="block text-[10px] font-bold uppercase text-slate-500 mb-1">Post-Promo APR</label>
                    <input type="number" class="bt-post-promo-apr w-full p-1 text-sm border border-slate-300 rounded dark:bg-slate-700 dark:border-slate-600" placeholder="21.9">
                </div>
                <div class="col-span-3">
                    <label class="block text-[10px] font-bold uppercase text-slate-500 mb-1">Minimum Payment Calculation</label>
                    <div class="flex space-x-2">
                        <select class="bt-min-pay-type w-2/3 p-1 text-xs border border-slate-300 rounded dark:bg-slate-700 dark:border-slate-600">
                             <option value="percentage_balance" selected>Percentage of Balance</option>
                             <option value="percentage_plus_interest">Interest + Percentage</option>
                             <option value="fixed">Fixed Amount</option>
                        </select>
                        <input type="number" class="bt-min-pay-val w-1/3 p-1 text-xs border border-slate-300 rounded dark:bg-slate-700 dark:border-slate-600" placeholder="1.0" value="1.0">
                    </div>
                </div>
            </div>
        `;
        setupBtElement(div, debouncedUpdate);
        container.appendChild(div);
        debouncedUpdate();
    });

    // Budget input
    const budgetEl = document.getElementById('monthly-budget');
    const sliderEl = document.getElementById('monthly-budget-slider');

    budgetEl.addEventListener('input', () => {
        if (sliderEl) sliderEl.value = budgetEl.value;
        validateBudgetAndToggleWarning();
        debouncedUpdate();
    });

    if (sliderEl) {
        sliderEl.addEventListener('input', () => {
            budgetEl.value = sliderEl.value;
            validateBudgetAndToggleWarning();
            debouncedUpdate();
        });
    }

    // Strategy change
    document.getElementById('strategy-select').addEventListener('change', debouncedUpdate);

    // Toggle Cost Chart
    const toggleCostBtn = document.getElementById('toggle-cost-chart-btn');
    const closeCostBtn = document.getElementById('close-cost-chart-btn');
    const costSection = document.getElementById('cost-chart-section');
    const mainSection = document.getElementById('main-chart-section');
    
    const setCostChartVisible = (visible) => {
        if (visible) {
            costSection.classList.remove('hidden');
            mainSection.classList.remove('lg:col-span-12');
            mainSection.classList.add('lg:col-span-8');
            toggleCostBtn.classList.add('hidden');
        } else {
            costSection.classList.add('hidden');
            mainSection.classList.remove('lg:col-span-8');
            mainSection.classList.add('lg:col-span-12');
            toggleCostBtn.classList.remove('hidden');
        }
        if (chart) chart.resize();
        if (costChart) costChart.resize();
    };

    if (toggleCostBtn) {
        toggleCostBtn.addEventListener('click', () => setCostChartVisible(true));
    }
    if (closeCostBtn) {
        closeCostBtn.addEventListener('click', () => setCostChartVisible(false));
    }
    
    // Simulate on demand
    //const chartSection = document.getElementById('debt-chart');
   // chartSection.addEventListener('click', debouncedUpdate);
}

function setupGroupElement(el, debouncedUpdate) {
    const groupNameInput = el.querySelector('.group-name');
    const groupNameText = el.querySelector('.group-name-text');
    const groupIndex = Array.from(document.querySelectorAll('.group-item')).indexOf(el);
    const color = `hsl(${(groupIndex * 70) % 360}, 70%, 50%)`;
    el.style.borderColor = color;

    el.querySelector('.remove-group').addEventListener('click', (e) => {
        e.stopPropagation();
        el.remove();
        debouncedUpdate();
    });

    const addSeg = el.querySelector('.add-segment-btn');
    addSeg.addEventListener('click', (e) => {
        e.stopPropagation();
        const segTpl = document.getElementById('segment-template');
        const clone = segTpl.content.cloneNode(true);
        const segEl = clone.querySelector('.segment-item');
        setupSegmentElement(segEl, debouncedUpdate);
        el.querySelector('.segments-container').appendChild(clone);
        debouncedUpdate();
    });

    const toggleBtn = el.querySelector('.toggle-group-details');
    const body = el.querySelector('.group-body');
    const summary = el.querySelector('.total-balance');
    const removeBtn = el.querySelector('.remove-group');

    toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isCollapsing = !body.classList.contains('hidden');
        body.classList.toggle('hidden', isCollapsing);
        summary.classList.toggle('hidden', !isCollapsing);
        removeBtn.classList.toggle('hidden', isCollapsing);
        groupNameInput.classList.toggle('hidden', isCollapsing);
        groupNameText.classList.toggle('hidden', !isCollapsing);
        groupNameText.textContent = groupNameInput.value;
        toggleBtn.textContent = isCollapsing ? 'Expand' : 'Collapse';
        if (isCollapsing) {
            updateGroupSummary(el);
        }
    });

    // wire existing segments
    el.querySelectorAll('.segment-item').forEach(segEl => setupSegmentElement(segEl, debouncedUpdate));
    // wire inputs to save on change
    el.querySelectorAll('input, select, textarea').forEach(inp => {
        inp.addEventListener('input', () => {
            updateGroupSummary(el);
            debouncedUpdate();
        });
    });
}

function setupSegmentElement(el, debouncedUpdate) {
    el.querySelector('.remove-segment').addEventListener('click', ()=>{ el.remove(); debouncedUpdate(); });
    const hasPromoCheck = el.querySelector('.segment-has-promo');
    if (hasPromoCheck) {
        const promoFields = el.querySelector('.promo-fields');
        hasPromoCheck.addEventListener('change', () => {
            promoFields.classList.toggle('hidden', !hasPromoCheck.checked);
            debouncedUpdate();
        });
    }
    el.querySelectorAll('input').forEach(inp => inp.addEventListener('input', debouncedUpdate));
}

function updateQuickDetails(sim) {
    const dailyInterestEl = document.getElementById('daily-interest');
    const payoffTimeEl = document.getElementById('payoff-time');
    const interestSavedEl = document.getElementById('interest-saved');

    if (!sim) {
        dailyInterestEl.textContent = '-';
        payoffTimeEl.textContent = '-';
        interestSavedEl.textContent = '-';
        return;
    }

    dailyInterestEl.textContent = `${formatCurrency(sim.initialDailyInterest || 0)}`;
    
    if (sim.payoffMonth) {
        const years = Math.floor(sim.payoffMonth / 12);
        const months = sim.payoffMonth % 12;
        payoffTimeEl.textContent = `${years > 0 ? `${years}y` : ''} ${months}m`;
    } else {
        payoffTimeEl.textContent = '30y+';
    }

    interestSavedEl.textContent = `${formatCurrency(sim.interestSavedFromBT || 0)}`;
}


export const ui = {
    init() {
        function updateApplication() {
            // Check budget but don't stop execution
            const isBudgetValid = validateBudgetAndToggleWarning();
            
            const state = gatherStateFromDOM();
            const sim = runSimulation(state, { maxMonths: 360 });
            
            // Run silent comparison to recommend strategy
            const comparisons = compareStrategies(state);
            const best = comparisons[0];
            const currentStrat = state.strategy;
            const recEl = document.getElementById('strategy-recommendation');
            
            if (best && best.strategy !== currentStrat && (best.totalInterest < sim.totalInterest - 10)) {
                // If the best strategy saves more than £10
                const saved = sim.totalInterest - best.totalInterest;
                const stratNames = {
                    'avalanche': 'Avalanche',
                    'snowball': 'Snowball',
                    'highest-interest-amount': 'Highest Interest Amount'
                };
                recEl.innerHTML = `💡 <strong>Tip:</strong> Switching to <u>${stratNames[best.strategy] || best.strategy}</u> could save you an extra <strong>${formatCurrency(saved)}</strong> in interest.`;
                recEl.classList.remove('hidden');
            } else {
                recEl.classList.add('hidden');
            }

            updateChart(sim);
            renderReport(sim);
            updateQuickDetails(sim);
            serializeToURL(state);
        }

        const debouncedUpdate = debounce(updateApplication, 300);

        initChart();
        wireControls(debouncedUpdate);
        
        const state = deserializeFromURL();
        if (state) {
            restoreStateToDOM(state);
            updateApplication();
            document.querySelectorAll('.group-item').forEach(el => setupGroupElement(el, debouncedUpdate));
            document.querySelectorAll('.windfall-item').forEach(el => setupWindfallElement(el, debouncedUpdate));
            document.querySelectorAll('.bt-item').forEach(el => setupBtElement(el, debouncedUpdate));
        }
    }
};

export default ui;
