// State Management & Persistence
// Serialisation/Deserialisation to URL hash

function escapeHTML(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

async function deriveKey(password, salt) {
    const encoder = new TextEncoder();
    const crypto = window.crypto || globalThis.crypto;
    const passwordKey = await crypto.subtle.importKey(
        'raw', 
        encoder.encode(password), 
        'PBKDF2', 
        false, 
        ['deriveKey']
    );
    return crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: salt,
            iterations: 100000,
            hash: 'SHA-256'
        },
        passwordKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

export async function encryptData(text, password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const crypto = window.crypto || globalThis.crypto;
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt);
    
    const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        data
    );

    const combined = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
    combined.set(salt, 0);
    combined.set(iv, salt.length);
    combined.set(new Uint8Array(encrypted), salt.length + iv.length);
    
    // Use standard btoa after converting to binary string
    return 'enc:' + btoa(String.fromCharCode(...combined));
}

export async function decryptData(encryptedBase64, password) {
    try {
        const combined = new Uint8Array(
            atob(encryptedBase64.replace('enc:', ''))
                .split('')
                .map(c => c.charCodeAt(0))
        );
        
        const salt = combined.slice(0, 16);
        const iv = combined.slice(16, 28);
        const data = combined.slice(28);
        
        const key = await deriveKey(password, salt);
        const crypto = window.crypto || globalThis.crypto;
        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv },
            key,
            data
        );
        
        return new TextDecoder().decode(decrypted);
    } catch (e) {
        console.error('Decryption failed', e);
        return null;
    }
}

function encodeState(obj) {
    try {
        const json = JSON.stringify(obj);
        return btoa(unescape(encodeURIComponent(json)));
    } catch (e) {
        return '';
    }
}

function decodeState(str) {
    try {
        const json = decodeURIComponent(escape(atob(str)));
        return JSON.parse(json);
    } catch (e) {
        return null;
    }
}

let _inMemoryPassword = null;
let _isLocked = false;

export function isAppStateLocked() {
    return _isLocked;
}

export function setSessionPassword(password, persist = true) {
    _inMemoryPassword = password;
    if (password) _isLocked = false; // Successfully set a password, so we're not locked
    if (persist && password) {
        sessionStorage.setItem('dsl_password', password);
    } else {
        sessionStorage.removeItem('dsl_password');
    }
}

export function getSessionPassword() {
    return _inMemoryPassword || sessionStorage.getItem('dsl_password');
}

export async function serializeToURL(stateObj) {
    const currentHash = (window.location.hash || '').replace(/^#/, '');
    const password = getSessionPassword();
    
    // Safety check: If we are currently on an encrypted URL but don't have the password,
    // we should NOT overwrite the URL because we haven't successfully "unlocked" yet.
    // This prevents accidental loss of encrypted data when playing with default values.
    if (currentHash.startsWith('enc:') && !password) {
        return;
    }

    let encoded;
    
    if (password) {
        const json = JSON.stringify(stateObj);
        encoded = await encryptData(json, password);
    } else {
        encoded = encodeState(stateObj);
    }

    if (encoded) {
        // Use replaceState to avoid cluttering history as requested
        const url = new URL(window.location);
        url.hash = encoded;
        window.history.replaceState(null, '', url);
    }
}

export async function deserializeFromURL(promptHandler = null) {
    const hash = (window.location.hash || '').replace(/^#/, '');
    if (!hash) return null;

    if (hash.startsWith('enc:')) {
        let password = getSessionPassword();
        if (!password) _isLocked = true;
        let retryCount = 0;

        while (true) {
            if (!password) {
                if (promptHandler) {
                    password = await promptHandler(retryCount > 0);
                } else {
                    password = prompt('This link is password protected. Please enter the password to gain access to the data:');
                }
                
                if (!password) return null; // Cancelled
            }
            
            const decryptedJson = await decryptData(hash, password);
            if (decryptedJson) {
                // Success! Ensure it's stored for this session
                setSessionPassword(password, false); 
                return JSON.parse(decryptedJson);
            } else {
                // Fail
                password = null;
                setSessionPassword(null); // Clear invalid cached password
                retryCount++;
                if (!promptHandler) {
                    alert('Incorrect password.');
                    return null;
                }
            }
        }
    }
    
    return decodeState(hash);
}

export function gatherStateFromDOM() {
    const state = { groups: [], windfalls: [], btOffers: [], monthlyBudget: 0, strategy: 'avalanche' };
    const budgetEl = document.getElementById('monthly-budget');
    if (budgetEl) state.monthlyBudget = Number(budgetEl.value) || 0;
    const stratEl = document.getElementById('strategy-select');
    if (stratEl) state.strategy = stratEl.value;

    const groups = document.querySelectorAll('.group-item');
    groups.forEach((gEl, gi) => {
        const name = gEl.querySelector('.group-name').value || `Card ${gi+1}`;
        const minPayType = gEl.querySelector('.min-pay-type')?.value || 'percentage_plus_interest';
        const minPayVal = Number(gEl.querySelector('.min-pay-val')?.value) || 1.0;
        const historicalPDMonths = Number(gEl.querySelector('.historical-pd-months')?.value) || 0;
        const priorityBtn = gEl.querySelector('.tsunami-priority-btn');
        const priority = (priorityBtn && priorityBtn.classList.contains('text-amber-500')) ? 1 : 999;

        const segments = [];
        gEl.querySelectorAll('.segment-item').forEach((sEl, si) => {
            const hasPromo = sEl.querySelector('.segment-has-promo').checked;
            segments.push({
                id: `${gi}-${si}`,
                name: sEl.querySelector('.segment-name').value || '',
                balance: Number(sEl.querySelector('.segment-balance').value) || 0,
                apr: Number(sEl.querySelector('.segment-apr').value) || 0,
                hasPromo: hasPromo,
                promoMonths: hasPromo ? Number(sEl.querySelector('.segment-promo-months').value) || 0 : 0,
                postPromoApr: hasPromo ? Number(sEl.querySelector('.segment-post-promo-apr').value) || 0 : 0,
                priority: priority // Propagate priority to segments
            });
        });
        state.groups.push({ id: gi, name, minPayType, minPayVal, historicalPDMonths, priority, segments });
    });

    // Windfalls
    document.querySelectorAll('.windfall-item').forEach(w => {
        state.windfalls.push({ month: Number(w.querySelector('.windfall-month').value)||0, amount: Number(w.querySelector('.windfall-amount').value)||0 });
    });

    // BT Offers
    document.querySelectorAll('.bt-item').forEach(b => {
        state.btOffers.push({ 
            id: b.dataset.btId,
            name: b.querySelector('.bt-name')?.value || `BT ${b.dataset.btId}`,
            cap: Number(b.querySelector('.bt-cap').value)||0, 
            feePercent: Number(b.querySelector('.bt-fee').value)||0, 
            promoApr: Number(b.querySelector('.bt-promo-apr').value)||0, 
            months: Number(b.querySelector('.bt-months').value)||0,
            postPromoApr: Number(b.querySelector('.bt-post-promo-apr').value) || 0,
            minPayType: b.querySelector('.bt-min-pay-type')?.value || 'percentage_balance',
            minPayVal: Number(b.querySelector('.bt-min-pay-val')?.value) || 1.0,
            enabled: b.querySelector('.bt-enabled').checked
        });
    });

    const calendarModeEl = document.getElementById('use-calendar-mode');
    state.useCalendar = calendarModeEl ? calendarModeEl.checked : false;

    const fcaSafetyEl = document.getElementById('fca-safety-mode');
    state.fcaSafetyMode = fcaSafetyEl ? fcaSafetyEl.checked : true;

    state.darkMode = document.documentElement.classList.contains('dark');
    return state;
}

export function restoreStateToDOM(state) {
    if (!state) return;
    // set global settings
    const budgetEl = document.getElementById('monthly-budget');
    if (budgetEl) budgetEl.value = state.monthlyBudget || '';
    const stratEl = document.getElementById('strategy-select');
    if (stratEl) stratEl.value = state.strategy || 'avalanche';
    if (state.darkMode) {
        document.documentElement.classList.add('dark');
        document.getElementById('dark-mode-toggle').textContent = 'Running in Dark Mode';
    }

    const calendarModeEl = document.getElementById('use-calendar-mode');
    if (calendarModeEl) {
        calendarModeEl.checked = state.useCalendar || false;
    }

    const fcaSafetyEl = document.getElementById('fca-safety-mode');
    if (fcaSafetyEl) {
        fcaSafetyEl.checked = state.fcaSafetyMode !== false;
    }

    // Clear existing groups
    const container = document.getElementById('debts-container');
    container.innerHTML = '';
    const groupTemplate = document.getElementById('group-template');
    (state.groups || []).forEach((g, gi) => {
        const clone = groupTemplate.content.cloneNode(true);
        const el = clone.querySelector('.group-item');
        el.querySelector('.group-name').value = g.name || '';
        
        // Restore Priority (Star)
        const priorityBtn = el.querySelector('.tsunami-priority-btn');
        if (priorityBtn && g.priority === 1) {
            priorityBtn.classList.add('text-amber-500');
            priorityBtn.classList.remove('text-slate-300');
        }

        // Restore min pay settings
        const typeSel = el.querySelector('.min-pay-type');
        if (typeSel) typeSel.value = g.minPayType || 'percentage_plus_interest';
        const valInp = el.querySelector('.min-pay-val');
        if (valInp) valInp.value = g.minPayVal || 1.0;

        // Restore PD history
        const pdInp = el.querySelector('.historical-pd-months');
        if (pdInp) pdInp.value = g.historicalPDMonths || 0;

        const segContainer = el.querySelector('.segments-container');
        const segTemplate = document.getElementById('segment-template');
        (g.segments || []).forEach(s => {
            const sClone = segTemplate.content.cloneNode(true);
            sClone.querySelector('.segment-name').value = s.name || '';
            sClone.querySelector('.segment-balance').value = s.balance || 0;
            sClone.querySelector('.segment-apr').value = s.apr || 0;
            const hasPromoCheck = sClone.querySelector('.segment-has-promo');
            const promoFields = sClone.querySelector('.promo-fields');
            if (s.hasPromo) {
                hasPromoCheck.checked = true;
                promoFields.classList.remove('hidden');
                sClone.querySelector('.segment-promo-months').value = s.promoMonths || 0;
                sClone.querySelector('.segment-post-promo-apr').value = s.postPromoApr || 0;
            }
            segContainer.appendChild(sClone);
        });
        container.appendChild(el);
    });

    // Restore Windfalls
    const windfallsContainer = document.getElementById('windfalls-container');
    windfallsContainer.innerHTML = '';
    (state.windfalls || []).forEach(w => {
        const div = document.createElement('div');
        div.className = 'windfall-item bg-white dark:bg-slate-850 p-3 rounded-lg shadow-sm relative';
        div.innerHTML = `
            <button class="remove-windfall absolute top-2 right-2 text-slate-400 hover:text-red-500 text-lg">&times;</button>
            <div class="grid grid-cols-2 gap-3">
                <div>
                    <label class="block text-[10px] font-bold uppercase text-slate-500 mb-1">Month</label>
                    <input type="number" class="windfall-month w-full p-1 text-sm border border-slate-300 rounded dark:bg-slate-700 dark:border-slate-600" value="${escapeHTML(w.month)}">
                </div>
                <div>
                    <label class="block text-[10px] font-bold uppercase text-slate-500 mb-1">Amount</label>
                    <input type="number" class="windfall-amount w-full p-1 text-sm border border-slate-300 rounded dark:bg-slate-700 dark:border-slate-600" value="${escapeHTML(w.amount)}">
                </div>
            </div>
        `;
        windfallsContainer.appendChild(div);
    });

    // Restore BT Offers
    const btOffersContainer = document.getElementById('bt-offers-container');
    btOffersContainer.innerHTML = '';
    (state.btOffers || []).forEach(bt => {
        const div = document.createElement('div');
        div.className = 'bt-item bg-white dark:bg-slate-850 p-3 rounded-lg shadow-sm relative';
        div.dataset.btId = bt.id;
        const isEnabled = bt.enabled !== false; // Default to true if undefined
        div.innerHTML = `
            <div class="flex justify-between items-center mb-2">
                <input type="text" class="bt-name flex-grow p-1 text-sm font-semibold border border-transparent rounded dark:bg-slate-850 dark:border-transparent focus:border-slate-300 dark:focus:border-slate-600 mr-2" value="${escapeHTML(bt.name)}" placeholder="e.g. New Card Offer">
                <div class="flex items-center space-x-2">
                    <label class="flex items-center cursor-pointer">
                        <input type="checkbox" class="bt-enabled sr-only peer" ${isEnabled ? 'checked' : ''}>
                        <div class="relative w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 dark:peer-focus:ring-indigo-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-indigo-600"></div>
                    </label>
                    <button class="remove-bt text-slate-400 hover:text-red-500 text-lg">&times;</button>
                </div>
            </div>
            <div class="grid grid-cols-3 gap-2">
                <div>
                    <label class="block text-[10px] font-bold uppercase text-slate-500 mb-1">Cap</label>
                    <input type="number" class="bt-cap w-full p-1 text-sm border border-slate-300 rounded dark:bg-slate-700 dark:border-slate-600" value="${escapeHTML(bt.cap)}">
                </div>
                <div>
                    <label class="block text-[10px] font-bold uppercase text-slate-500 mb-1">Fee %</label>
                    <input type="number" class="bt-fee w-full p-1 text-sm border border-slate-300 rounded dark:bg-slate-700 dark:border-slate-600" value="${escapeHTML(bt.feePercent)}">
                </div>
                <div>
                    <label class="block text-[10px] font-bold uppercase text-slate-500 mb-1">Promo APR</label>
                    <input type="number" class="bt-promo-apr w-full p-1 text-sm border border-slate-300 rounded dark:bg-slate-700 dark:border-slate-600" value="${escapeHTML(bt.promoApr)}">
                </div>
                <div>
                    <label class="block text-[10px] font-bold uppercase text-slate-500 mb-1">Months</label>
                    <input type="number" class="bt-months w-full p-1 text-sm border border-slate-300 rounded dark:bg-slate-700 dark:border-slate-600" value="${escapeHTML(bt.months)}">
                </div>
                <div>
                    <label class="block text-[10px] font-bold uppercase text-slate-500 mb-1">Post-Promo APR</label>
                    <input type="number" class="bt-post-promo-apr w-full p-1 text-sm border border-slate-300 rounded dark:bg-slate-700 dark:border-slate-600" value="${escapeHTML(bt.postPromoApr)}">
                </div>
                <div class="col-span-3">
                    <div class="flex space-x-2 items-end">
                        <div class="flex-grow">
                             <label class="block text-[10px] font-bold uppercase text-slate-500 mb-1">Minimum Payment Calculation</label>
                             <select class="bt-min-pay-type w-full p-1 text-xs border border-slate-300 rounded dark:bg-slate-700 dark:border-slate-600">
                                 <option value="percentage_balance" ${(!bt.minPayType || bt.minPayType==='percentage_balance')?'selected':''}>Percentage of Balance</option>
                                 <option value="percentage_plus_interest" ${(bt.minPayType==='percentage_plus_interest')?'selected':''}>Interest + Percentage</option>
                                 <option value="fixed" ${(bt.minPayType==='fixed')?'selected':''}>Fixed Amount</option>
                            </select>
                        </div>
                        <div class="w-1/3">
                            <label class="block text-[10px] font-bold uppercase text-slate-500 mb-1">Value</label>
                            <input type="number" class="bt-min-pay-val w-full p-1 text-xs border border-slate-300 rounded dark:bg-slate-700 dark:border-slate-600" value="${escapeHTML(bt.minPayVal)}">
                        </div>
                    </div>
                </div>
            </div>
        `;
        btOffersContainer.appendChild(div);
    });
}

export default {
    serializeToURL,
    deserializeFromURL,
    gatherStateFromDOM,
    restoreStateToDOM,
    setSessionPassword,
    getSessionPassword,
    encryptData,
    decryptData,
};
