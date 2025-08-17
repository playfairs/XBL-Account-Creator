const { appendFileSync } = require("node:fs");
const electron = require("electron");

(async () => {
    electron.app.on("ready", async () => {
        const mainWindow = new electron.BrowserWindow({
            width: 1000,
            height: 800,
            webPreferences: {
                nodeIntegration: true,
                partition: "persist:main",
            }
        });

        mainWindow.loadURL("https://www.xbox.com/en-CA/auth/msa?action=logIn&returnUrl=https%3A%2F%2Fwww.xbox.com%2Fen-CA%2F");
        let currentAccount = { email: "", password: "" };
        let lastTitle;
        
        setInterval(async () => {
            try {
                const title = await getPage(mainWindow);
                if (title === lastTitle || title === "Unknown") return;
                lastTitle = title;
                console.log(title);
                
                switch (title) {
                    case "Xbox Official Site: Consoles, Games, and Community | Xbox":
                        mainWindow.loadURL("https://www.xbox.com/en-CA/auth/msa?action=logIn&returnUrl=https%3A%2F%2Fwww.xbox.com%2Fen-CA%2F");
                        break;
                    case "Sign in to your Microsoft account":
                        await new Promise((resolve) => setTimeout(resolve, 1000));
                        await tryMultipleSelectors(mainWindow, ["#signup", "#i0116"], `document.querySelector('SELECTOR').click()`);
                        break;
                    case "Create account":
                        console.log("=== DOM INSPECTION FOR CREATE ACCOUNT PAGE ===");
                        
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        
                        await inspectDOM(mainWindow);
                        
                        try {
                            const hasError = await mainWindow.webContents.executeJavaScript(`
                                Boolean(document.querySelector('[role="alert"]')) || 
                                Boolean(document.querySelector('.error')) || 
                                document.body.textContent.includes('email address is required')
                            `);
                            
                            if (hasError) {
                                console.log("Email validation error detected, retrying email input...");
                            }
                        } catch (error) {
                            console.log("Could not check for errors, continuing...");
                        }
                        
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        
                        const numbers = new Array(10).fill(0).map(() => Math.floor(Math.random() * 10)).join("");
                        const letters = new Array(5).fill(0).map(() => String.fromCharCode(Math.floor(Math.random() * 26) + 97)).join("");
                        currentAccount.email = `${letters}${numbers}@outlook.com`;
                        
                        const email = currentAccount.email;
                        
                        await waitForElementAndExecute(mainWindow, "#usernameInput", `
                            const input = document.querySelector('#usernameInput');
                            input.focus();
                            input.click();
                        `);
                        
                        await new Promise(resolve => setTimeout(resolve, 500));
                        
                        for (let i = 0; i < 50; i++) {
                            mainWindow.webContents.sendInputEvent({
                                type: 'keyDown',
                                keyCode: 'Backspace'
                            });
                            mainWindow.webContents.sendInputEvent({
                                type: 'keyUp',
                                keyCode: 'Backspace'
                            });
                        }
                        
                        for (let char of email) {
                            mainWindow.webContents.sendInputEvent({
                                type: 'char',
                                keyCode: char
                            });
                            await new Promise(resolve => setTimeout(resolve, 50));
                        }
                        
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        
                        try {
                            const finalValue = await mainWindow.webContents.executeJavaScript(`document.querySelector('#usernameInput').value`);
                            console.log(`Final input value before clicking Next: ${finalValue}`);
                            
                            if (!finalValue || finalValue.trim() === '') {
                                console.log("Email was cleared, trying to set it again...");
                                await waitForElementAndExecute(mainWindow, "#usernameInput", `
                                    const input = document.querySelector('#usernameInput');
                                    input.focus();
                                    input.value = '${currentAccount.email}';
                                    input.dispatchEvent(new Event('input', { bubbles: true }));
                                `);
                                await new Promise(resolve => setTimeout(resolve, 1000));
                            }
                        } catch (error) {
                            console.log("Could not verify input value before clicking");
                        }
                        
                        await waitForElementAndExecute(mainWindow, "#nextButton", `document.querySelector('#nextButton').click()`);
                        
                        console.log(`Created email: ${currentAccount.email}`);
                        break;
                    case "Create a password":
                        const password = [2, 2, 2, 2].map((length, index) => {
                            switch (index) {
                                case 0:
                                    return new Array(length).fill(0).map(() => String.fromCharCode(Math.floor(Math.random() * 26) + 97)).join("");
                                case 1:
                                    return new Array(length).fill(0).map(() => String.fromCharCode(Math.floor(Math.random() * 26) + 65)).join("");
                                case 2:
                                    return new Array(length).fill(0).map(() => Math.floor(Math.random() * 10)).join("");
                                case 3:
                                    return new Array(length).fill(0).map(() => String.fromCharCode(Math.floor(Math.random() * 15) + 33)).join("");
                            }
                        }).join("");
                        
                        console.log(`Created password: ${password}`)
                        currentAccount.password = password;
                        await new Promise((r) => setTimeout(r, 1000));
                        
                        await waitForElementAndExecute(mainWindow, "#Password", `
                            const input = document.querySelector('#Password');
                            input.focus();
                            input.click();
                        `);
                        
                        await new Promise(resolve => setTimeout(resolve, 500));
                        
                        for (let i = 0; i < 50; i++) {
                            mainWindow.webContents.sendInputEvent({
                                type: 'keyDown',
                                keyCode: 'Backspace'
                            });
                            mainWindow.webContents.sendInputEvent({
                                type: 'keyUp',
                                keyCode: 'Backspace'
                            });
                        }
                        
                        for (let char of password) {
                            mainWindow.webContents.sendInputEvent({
                                type: 'char',
                                keyCode: char
                            });
                            await new Promise(resolve => setTimeout(resolve, 50));
                        }
                        
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        
                        try {
                            const finalValue = await mainWindow.webContents.executeJavaScript(`document.querySelector('#Password').value`);
                            console.log(`Final password value before clicking Next: ${finalValue ? '[HIDDEN]' : 'EMPTY'}`);
                            
                            if (!finalValue || finalValue.trim() === '') {
                                console.log("Password was cleared, trying to set it again...");
                                await waitForElementAndExecute(mainWindow, "#Password", `
                                    const input = document.querySelector('#Password');
                                    input.focus();
                                    input.value = '${password}';
                                    input.dispatchEvent(new Event('input', { bubbles: true }));
                                `);
                                await new Promise(resolve => setTimeout(resolve, 1000));
                            }
                        } catch (error) {
                            console.log("Could not verify password value before clicking");
                        }
                        
                        await waitForElementAndExecute(mainWindow, "#nextButton", `document.querySelector('#nextButton').click()`);
                        break;
                    case "What's your name?":
                        console.log("=== DOM INSPECTION FOR NAME PAGE ===");
                        
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        
                        await inspectDOM(mainWindow);
                        
                        const firstNames = ["Alex", "Jordan", "Taylor", "Casey", "Riley", "Morgan", "Avery", "Quinn", "Sage", "River"];
                        const lastNames = ["Smith", "Johnson", "Brown", "Davis", "Miller", "Wilson", "Moore", "Taylor", "Anderson", "Thomas"];
                        const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
                        const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
                        
                        console.log(`Generated names: ${firstName} ${lastName}`);
                        
                        console.log("Typing first name...");
                        
                        await waitForElementAndExecute(mainWindow, "#firstNameInput", `
                            const input = document.querySelector('#firstNameInput');
                            input.focus();
                            input.click();
                        `);
                        
                        await new Promise(resolve => setTimeout(resolve, 500));
                        
                        for (let i = 0; i < 20; i++) {
                            mainWindow.webContents.sendInputEvent({
                                type: 'keyDown',
                                keyCode: 'Backspace'
                            });
                            mainWindow.webContents.sendInputEvent({
                                type: 'keyUp',
                                keyCode: 'Backspace'
                            });
                        }
                        
                        for (let char of firstName) {
                            mainWindow.webContents.sendInputEvent({
                                type: 'char',
                                keyCode: char
                            });
                            await new Promise(resolve => setTimeout(resolve, 50));
                        }
                        
                        console.log(`First name "${firstName}" typed successfully`);
                        
                        await new Promise(resolve => setTimeout(resolve, 500));
                        mainWindow.webContents.sendInputEvent({
                            type: 'keyDown',
                            keyCode: 'Tab'
                        });
                        mainWindow.webContents.sendInputEvent({
                            type: 'keyUp',
                            keyCode: 'Tab'
                        });
                        console.log("Pressed Tab to move to last name field");
                        
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        
                        console.log("Typing last name...");
                        
                        for (let char of lastName) {
                            mainWindow.webContents.sendInputEvent({
                                type: 'char',
                                keyCode: char
                            });
                            await new Promise(resolve => setTimeout(resolve, 50));
                        }
                        
                        console.log(`Last name "${lastName}" typed successfully`);
                        
                        await new Promise(resolve => setTimeout(resolve, 500));
                        mainWindow.webContents.sendInputEvent({
                            type: 'keyDown',
                            keyCode: 'Return'
                        });
                        mainWindow.webContents.sendInputEvent({
                            type: 'keyUp',
                            keyCode: 'Return'
                        });
                        console.log("Pressed Enter to submit form");
                        
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        
                        await waitForElementAndExecute(mainWindow, "#nextButton", `document.querySelector('#nextButton').click()`);
                        break;
                    case `What's your date of birth?`:
                        await tryMultipleSelectors(mainWindow, ["#BirthMonth", "#BirthMonth_DropDown"], `document.querySelector('SELECTOR').value = "${Math.max(1, Math.floor(Math.random() * 12))}";`);
                        await new Promise(resolve => setTimeout(resolve, 500));
                        await tryMultipleSelectors(mainWindow, ["#BirthMonth", "#BirthMonth_DropDown"], `document.querySelector('SELECTOR').dispatchEvent(new Event("change"));`);
                        
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        
                        await tryMultipleSelectors(mainWindow, ["#BirthDay", "#BirthDay_DropDown"], `document.querySelector('SELECTOR').value = "${Math.max(1, Math.floor(Math.random() * 15))}";`);
                        await new Promise(resolve => setTimeout(resolve, 500));
                        await tryMultipleSelectors(mainWindow, ["#BirthDay", "#BirthDay_DropDown"], `document.querySelector('SELECTOR').dispatchEvent(new Event("change"));`);
                        
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        
                        await tryMultipleSelectors(mainWindow, ["#BirthYear", "#BirthYear_DropDown"], `document.querySelector('SELECTOR').value = "1995";`);
                        await new Promise(resolve => setTimeout(resolve, 500));
                        await tryMultipleSelectors(mainWindow, ["#BirthYear", "#BirthYear_DropDown"], `document.querySelector('SELECTOR').dispatchEvent(new Event("input"));`);
                        
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        
                        try {
                            const fieldValues = await mainWindow.webContents.executeJavaScript(`
                                const month = document.querySelector('#BirthMonth');
                                const day = document.querySelector('#BirthDay');
                                const year = document.querySelector('#BirthYear');
                                return {
                                    month: month ? month.value : 'not found',
                                    day: day ? day.value : 'not found',
                                    year: year ? year.value : 'not found'
                                };
                            `);
                            console.log('Birth date field values before Next:', fieldValues);
                        } catch (error) {
                            console.log('Could not verify field values:', error.message);
                        }
                        
                        console.log('Attempting to click Next button...');
                        try {
                            const clickResult = await mainWindow.webContents.executeJavaScript(`
                                const nextButton = document.querySelector('#nextButton');
                                if (nextButton) {
                                    nextButton.click();
                                    return 'Next button clicked';
                                } else {
                                    return 'Next button not found';
                                }
                            `);
                            console.log('Next button click result:', clickResult);
                        } catch (error) {
                            console.log('Next button click error:', error.message);
                        }
                        
                        await new Promise(resolve => setTimeout(resolve, 3000));
                        try {
                            const currentTitle = await mainWindow.webContents.executeJavaScript(`document.title`);
                            console.log('Current page title after Next click:', currentTitle);
                            
                            if (currentTitle.includes('birthdate')) {
                                console.log('STILL ON BIRTH DATE PAGE - checking field values after click');
                                const postClickValues = await mainWindow.webContents.executeJavaScript(`
                                    const month = document.querySelector('#BirthMonth');
                                    const day = document.querySelector('#BirthDay');
                                    const year = document.querySelector('#BirthYear');
                                    return {
                                        month: month ? month.value : 'not found',
                                        day: day ? day.value : 'not found',
                                        year: year ? year.value : 'not found'
                                    };
                                `);
                                console.log('Field values after Next click:', postClickValues);
                            } else {
                                console.log('Successfully moved to next page:', currentTitle);
                            }
                        } catch (error) {
                            console.log('Could not check page after Next click:', error.message);
                        }
                        break;
                    case "Help us beat the robots":
                        console.log("Handling accessibility challenge page...");
                        
                        console.log("Looking for Accessibility Challenge button...");
                        const accessibilityResult = await waitForElementAndExecute(mainWindow, "button", `
                            const buttons = Array.from(document.querySelectorAll('button'));
                            const accessibilityButton = buttons.find(btn => 
                                btn.textContent && btn.textContent.toLowerCase().includes('accessibility challenge')
                            );
                            if (accessibilityButton) {
                                accessibilityButton.click();
                                console.log('Clicked Accessibility Challenge button');
                                return true;
                            }
                            return false;
                        `);
                        
                        if (accessibilityResult) {
                            console.log("Accessibility Challenge button clicked, waiting 5-10 seconds...");
                            const waitTime = Math.floor(Math.random() * 5000) + 5000; // 5-10 seconds
                            await new Promise(resolve => setTimeout(resolve, waitTime));
                            
                            console.log("Looking for Press Again button...");
                            const pressAgainResult = await waitForElementAndExecute(mainWindow, "button", `
                                const buttons = Array.from(document.querySelectorAll('button'));
                                const pressAgainButton = buttons.find(btn => 
                                    btn.textContent && btn.textContent.toLowerCase().includes('press again')
                                );
                                if (pressAgainButton) {
                                    pressAgainButton.click();
                                    console.log('Clicked Press Again button');
                                    return true;
                                }
                                return false;
                            `);
                            
                            if (!pressAgainResult) {
                                console.log("Press Again button not found, trying alternative selectors...");
                                await tryMultipleSelectors(mainWindow, ["button[aria-label*='again']", "button[title*='again']", "input[value*='again']"], `document.querySelector('SELECTOR').click();`);
                            }
                        } else {
                            console.log("Accessibility Challenge button not found, trying alternative approaches...");
                            await tryMultipleSelectors(mainWindow, ["button[aria-label*='accessibility']", "button[title*='accessibility']", "input[value*='accessibility']"], `document.querySelector('SELECTOR').click();`);
                        }
                        break;
                    case "Microsoft account notice":
                        await new Promise((r) => setTimeout(r, 1000));
                        await tryMultipleSelectors(mainWindow, ["#StickyFooter > button", "#idSubmit_SAOTCS_Confirm"], `document.querySelector('SELECTOR').click();`);
                        break;
                    case "Welcome to Xbox":
                        appendFileSync(__dirname + "/../accounts.txt", `${currentAccount.email}:${currentAccount.password}\n`);
                        console.log(`Account created: ${currentAccount.email}:${currentAccount.password}`);
                        await new Promise((r) => setTimeout(r, 2000));
                        await tryMultipleSelectors(mainWindow, ["#create-account-gamertag-suggestion-1", "#create-account-gamertag-suggestion-1"], `document.querySelector('SELECTOR').click();`);
                        await new Promise((r) => setTimeout(r, 2000));
                        await tryMultipleSelectors(mainWindow, ["#inline-continue-control", "#idSubmit_SAOTCS_Confirm"], `document.querySelector('SELECTOR').click();`);
                        break;
                    case "Consent":
                        await new Promise((r) => setTimeout(r, 1000));
                        await tryMultipleSelectors(mainWindow, ["#inline-continue-control", "#idSubmit_SAOTCS_Confirm"], `document.querySelector('SELECTOR').click();`);
                        break;
                }
            } catch (error) {
                console.error(`Error in main loop: ${error.message}`);
            }
        }, 250);
    });
})().catch(error => {
    console.error(`Application error: ${error.message}`);
});

const executeJavaScriptSafely = async (mainWindow, script) => {
    try {
        return await mainWindow.webContents.executeJavaScript(script);
    } catch (error) {
        console.error(`JavaScript execution failed: ${error.message}`);
        console.error(`Script: ${script}`);
        return null;
    }
};

const waitForElementAndExecute = async (mainWindow, selector, action, maxRetries = 5) => {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const elementExists = await mainWindow.webContents.executeJavaScript(
                `Boolean(document.querySelector("${selector}"))`
            );
            
            if (elementExists) {
                const result = await mainWindow.webContents.executeJavaScript(action);
                console.log(`Successfully executed: ${action}`);
                return result;
            } else {
                console.log(`Element not found (attempt ${i + 1}/${maxRetries}): ${selector}`);
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        } catch (error) {
            console.error(`Error waiting for element ${selector}: ${error.message}`);
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }
    console.error(`Failed to find element after ${maxRetries} attempts: ${selector}`);
    return null;
};

const tryMultipleSelectors = async (mainWindow, selectors, action) => {
    for (const selector of selectors) {
        const result = await waitForElementAndExecute(mainWindow, selector, action.replace('SELECTOR', selector));
        if (result !== null) {
            return result;
        }
    }
    console.error(`All selectors failed: ${selectors.join(', ')}`);
    return null;
};

const inspectDOM = async (mainWindow) => {
    try {
        const isReady = await mainWindow.webContents.executeJavaScript(`document.readyState`);
        console.log(`Document ready state: ${isReady}`);
        
        const hasInputs = await mainWindow.webContents.executeJavaScript(`document.querySelectorAll('input').length`);
        const hasButtons = await mainWindow.webContents.executeJavaScript(`document.querySelectorAll('button').length`);
        console.log(`Found ${hasInputs} inputs and ${hasButtons} buttons`);
        
        const title = await mainWindow.webContents.executeJavaScript(`document.title`);
        const url = await mainWindow.webContents.executeJavaScript(`window.location.href`);
        console.log(`Page: ${title}`);
        console.log(`URL: ${url}`);
        
        const inputs = await mainWindow.webContents.executeJavaScript(`
            Array.from(document.querySelectorAll('input')).map((el, i) => ({
                index: i,
                type: el.type,
                id: el.id,
                name: el.name,
                placeholder: el.placeholder,
                className: el.className
            }))
        `);
        
        console.log("Input elements:", inputs);
        
        const buttons = await mainWindow.webContents.executeJavaScript(`
            Array.from(document.querySelectorAll('button')).map((el, i) => ({
                index: i,
                type: el.type,
                id: el.id,
                className: el.className,
                textContent: el.textContent?.trim()
            }))
        `);
        
        console.log("Button elements:", buttons);
        
        return { inputs, buttons };
    } catch (error) {
        console.error("Failed to inspect DOM:", error.message);
        return { inputs: [], buttons: [] };
    }
};

const getPage = async (mainWindow) => {
    const pageMap = {
        "Sign in to your Microsoft account": "#usernameTitle",
        "Create a password": "input[type=password]",
        "What's your name?": ["input[placeholder*='First name']", "input[placeholder*='first name']", "#firstNameInput", "#lastNameInput"],
        "What's your date of birth?": "#BirthMonth",
        "Microsoft account notice": "#StickyFooter > button",
        "Welcome to Xbox": "#create-account-gamertag-suggestion-1",
        "Consent": "#inline-continue-control",
        "Create account": "#liveSwitch",
        "Xbox Official Site: Consoles, Games, and Community | Xbox": "#signup",
        "Add security info": "#hipEnforcementContainer"
    };

    try {
        const actualTitle = await mainWindow.webContents.executeJavaScript(`document.title`);
        console.log(`Actual page title: "${actualTitle}"`);
        
        for (let title in pageMap) {
            const selectors = Array.isArray(pageMap[title]) ? pageMap[title] : [pageMap[title]];
            
            for (const selector of selectors) {
                const element = await mainWindow.webContents.executeJavaScript(`Boolean(document.querySelector("${selector}"))`);
                if (element) {
                    console.log(`Page detected as "${title}" using selector: ${selector}`);
                    return title;
                }
            }
        }
        
        console.log("No page detected, checking for common elements...");
        const hasFirstNameInput = await mainWindow.webContents.executeJavaScript(`
            Boolean(document.querySelector('input[placeholder*="First name"]') || 
                   document.querySelector('input[placeholder*="first name"]'))
        `);
        
        if (hasFirstNameInput) {
            console.log("Found first name input, assuming this is the name page");
            return "What's your name?";
        }
        
        return "Unknown";
    } catch (error) {
        console.error(`Error in getPage: ${error.message}`);
        return "Unknown";
    }
}
