import { filterAndRunTests, summarize } from "./test_framework.js";


filterAndRunTests().then(() => {
    summarize();
}); 
