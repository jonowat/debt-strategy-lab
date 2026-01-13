# Debt Strategy Lab

A local-first, browser-based simulator for visualizing debt payoff strategies. Compare "Avalanche" vs "Snowball" methods, model Balance Transfers with promotional APRs, and experiment with monthly budgets to see your "Debt Freedom Date" move in real-time.



## Features

- **Privacy First**: All calculations run locally in your browser. No financial data is sent to any server. State is saved via the URL, so you can bookmark it or share anonymized configurations.
- **Multiple Strategies**:
  - **Avalanche**: Targets highest interest rate first (mathematically optimal).
  - **Snowball**: Targets lowest balance first (psychologically motivating).
  - **Highest Interest Amount**: Targets the debt generating the most raw interest currency per month.
- **Detailed Modelling**:
  - Support for multiple Cards/Loans with different minimum payment definitions.
  - **Promotional APRs**: Model "0% for 12 months" segments on credit cards.
  - **Balance Transfers**: Simulate moving debt to a new card with a 3% fee and 0% APR period, determining if the fee is worth the interest savings.
  - **Windfalls**: Add one-off lump sum payments (e.g., tax refunds, bonuses) at specific months.
- **Interactive Visualizations**:
  - **Payoff Timeline**: Dynamic line chart showing balance reduction over time.
  - **Cost Breakdown**: Donut chart visualizing Principal vs. Interest vs. Fees.
  - **"What-If" Slider**: Drag your monthly budget to instantly see how extra payments shorten your timeline.

## Calculations & Assumptions

The simulator uses a monthly cycle for all projections. While real-world daily compounding varies slightly by lender, the engine uses the following logic to provide a highly accurate estimation:

### 1. Interest Calculation
- **Daily Rate**: `APR / 100 / 365`
- **Monthly Accrual**: `Balance * (APR / 100) / 12`
- Interest is accrued *before* payments are applied in the simulation cycle (imitating standard average daily balance methods).

### 2. Minimum Payment Floor
- Minimum payments are calculated based on the user-defined settings for each debt group (e.g., "1% of Balance + Interest" or "Fixed £25").
- **Hard Floor**: The system assumes a minimum payment floor of **£5 (or 5 units)**. If the calculated minimum is less than £5, it defaults to £5 (or the remaining balance if lower).

### 3. Payment Hierarchy (Waterfall)
1.  **Accrue Interest**: Interest for the current month is added to the balance.
2.  **Minimums First**: The "Required Minimum" for *every* debt is paid first from the monthly budget.
3.  **Windfalls**: Any lump sums defined for the current month are added to the "Available Budget" (after minimums).
4.  **Strategy Allocation**: Any remaining budget (Surplus) is applied to the target debt determined by the selected strategy (e.g., Highest APR).
5.  **Balance Transfers**: If a BT offer is active and triggered (Month 1), the engine moves balance from high-APR segments to the new BT segment, applying the defined fee immediately.

### 4. Balance Transfers
- Fees are added to the balance of the *new* card immediately.
- The simulator attempts to move debt from the **Highest APR** segments first.
- When a promo period ends, the APR automatically reverts to the "Post-Promo APR" defined in the offer.

## Usage

1.  **Add Debts**: Create groups for your Credit Cards or Loans. Add segments for balances at different rates (e.g., "Main Balance" at 29% and "Promo Balance" at 0%).
2.  **Set Budget**: Enter your total monthly budget available for debt repayment.
    - *Note*: The minimum limit of the slider is your absolute required minimum payments.
3.  **Choose Strategy**: Toggle between Avalanche and Snowball to see the difference in total interest paid and time-to-freedom.
4.  **Experiment**: Use the slider to see how finding an extra £50/month impacts your journey.

## Development

The project is built with:
- **HTML5 & Vanilla JavaScript** (ES6 Modules)
- **Tailwind CSS** (via CDN for rapid UI development)
- **Chart.js** (for visualizations)

### Structure
- `index.html`: Main UI and layout.
- `js/engine.js`: Pure mathematical logic for the simulation.
- `js/ui.js`: DOM manipulation, event listeners, and Chart rendering.
- `js/state.js`: URL serialization logic (Base64 encoding of JSON state).

### Running Locally
Since the project uses ES Modules, you cannot simply open `index.html` via `file://`. You must serve it via a local web server to avoid CORS errors.

```bash
# Using Python
python -m http.server 8000

# Using Node (http-server)
npx http-server .

#Or
npm start
```

Then visit `http://localhost:8000`.

## License
MIT
