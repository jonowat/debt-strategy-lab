// Main Controller
import engine from './engine.js';
import state from './state.js';

import ui from './ui.js';

document.addEventListener('DOMContentLoaded', () => {
    console.log('Debt Strategy Lab initialized');
    ui.init();

    // Add event listener for the print button
    const printButton = document.getElementById('print-action-plan');
    if (printButton) {
        printButton.addEventListener('click', () => {
            window.print();
        });
    }
});
