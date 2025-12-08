/**
 * This is a rewritten version of a different tool, which was used to create SINGLE accounts per run.
 *
 *   Rewritten to:
 * - Speed up password detection/fill by using a persisted selector cache.
 * - getPage quick-checks persisted selector(s) before doing broad scans.
 * - When on the "Create a password" page, injects a renderer-side MutationObserver
 *   script that will fill the password immediately when the input appears (fast-path).
 *
 * Notes:
 * - This file is intended to run under Electron in the main process.
 * - It uses simple file-based persistence (selectors.json) for discovered selectors.
 */

const {
  appendFileSync,
  readFileSync,
  writeFileSync,
  existsSync,
} = require("fs");
const path = require("path");
const electron = require("electron");

const SELECTORS_FILE = path.join(__dirname, "..", "selectors.json");
const ACCOUNTS_FILE = path.join(__dirname, "..", "accounts.txt");

let persistedSelectors = {};
try {
  if (existsSync(SELECTORS_FILE)) {
    const raw = readFileSync(SELECTORS_FILE, "utf8");
    persistedSelectors = JSON.parse(raw || "{}");
    console.log("Loaded selector cache:", persistedSelectors);
  } else {
    persistedSelectors = {};
  }
} catch (err) {
  console.warn(
    "Could not load selector cache:",
    err && err.message ? err.message : err,
  );
  persistedSelectors = {};
}

function persistSelector(key, selector) {
  try {
    persistedSelectors[key] = selector;
    writeFileSync(
      SELECTORS_FILE,
      JSON.stringify(persistedSelectors, null, 2),
      "utf8",
    );
    console.log(`Persisted selector for "${key}": ${selector}`);
  } catch (err) {
    console.warn(
      "Failed to persist selector:",
      err && err.message ? err.message : err,
    );
  }
}

async function execSafe(webContents, script) {
  try {
    return await webContents.executeJavaScript(script);
  } catch (err) {
    console.warn(
      "executeJavaScript failed:",
      err && err.message ? err.message : err,
    );
    return null;
  }
}

async function waitForElementAndExecute(
  webContents,
  selector,
  actionScript,
  maxRetries = 5,
  pollMs = 120,
) {
  const checkScript = `(function(){ try { return Boolean(document.querySelector(${JSON.stringify(selector)})); } catch(e) { return false; } })()`;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const exists = await webContents.executeJavaScript(checkScript);
      if (exists) {
        const res = await webContents.executeJavaScript(actionScript);
        console.log(`Executed action for ${selector}`);
        return res;
      } else {
        await new Promise((r) => setTimeout(r, pollMs));
      }
    } catch (err) {
      console.warn(
        `Error while waiting for ${selector}:`,
        err && err.message ? err.message : err,
      );
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }
  console.error(
    `Failed to find element after ${maxRetries} attempts: ${selector}`,
  );
  return null;
}

async function tryMultipleSelectors(
  webContents,
  selectors,
  action,
  maxRetriesPer = 4,
) {
  for (const selector of selectors) {
    const replacedAction = action
      .replace(/'SELECTOR'/g, JSON.stringify(selector))
      .replace(/"SELECTOR"/g, JSON.stringify(selector))
      .replace(/\bSELECTOR\b/g, JSON.stringify(selector));
    const res = await waitForElementAndExecute(
      webContents,
      selector,
      replacedAction,
      maxRetriesPer,
    );
    if (res !== null) return res;
  }
  console.error("All selectors failed:", selectors);
  return null;
}

async function inspectDOM(webContents) {
  try {
    const ready = await execSafe(webContents, "document.readyState");
    const title = await execSafe(webContents, "document.title");
    const url = await execSafe(webContents, "window.location.href");
    const inputs = await execSafe(
      webContents,
      `
      Array.from(document.querySelectorAll('input')).map((el, i) => ({
        index: i,
        id: el.id,
        name: el.name,
        type: el.type,
        placeholder: el.placeholder,
        className: el.className
      }));
    `,
    );
    const buttons = await execSafe(
      webContents,
      `
      Array.from(document.querySelectorAll('button')).map((el, i) => ({
        index: i,
        id: el.id,
        className: el.className,
        textContent: el.textContent ? el.textContent.trim() : ''
      }));
    `,
    );
    console.log("DOM readyState:", ready, "title:", title, "url:", url);
    console.log("Input elements:", inputs);
    console.log("Button elements:", buttons);
    return { ready, title, url, inputs, buttons };
  } catch (err) {
    console.warn("inspectDOM failed:", err && err.message ? err.message : err);
    return { ready: null, title: null, url: null, inputs: [], buttons: [] };
  }
}

// Function to simulate human-like typing with realistic delays
async function simulateTyping(webContents, selector, text, delay = 50) {
  // Click the input first to focus it
  await webContents.executeJavaScript(`
    (function() {
      const el = document.querySelector('${selector}');
      if (el) {
        el.click();
        return true;
      }
      return false;
    })()
  `);
  
  // Type each character with a small random delay
  for (const char of text) {
    await new Promise(resolve => setTimeout(resolve, delay + Math.random() * 50));
    await webContents.executeJavaScript(`
      (function() {
        const el = document.querySelector('${selector}');
        if (el) {
          // Create and dispatch input event
          const inputEvent = new Event('input', { bubbles: true });
          el.value += '${char}';
          el.dispatchEvent(inputEvent);
          
          // Also trigger keydown, keypress, and keyup events
          const keyEvent = new KeyboardEvent('keydown', {
            key: '${char}',
            keyCode: '${char}'.charCodeAt(0),
            which: '${char}'.charCodeAt(0),
            code: 'Key${char.toUpperCase()}',
            keyIdentifier: 'U+${'${char}'.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}',
            bubbles: true,
            cancelable: true
          });
          el.dispatchEvent(keyEvent);
          
          const keyPressEvent = new KeyboardEvent('keypress', {
            key: '${char}',
            keyCode: '${char}'.charCodeAt(0),
            which: '${char}'.charCodeAt(0),
            charCode: '${char}'.charCodeAt(0),
            bubbles: true,
            cancelable: true
          });
          el.dispatchEvent(keyPressEvent);
          
          const keyUpEvent = new KeyboardEvent('keyup', {
            key: '${char}',
            keyCode: '${char}'.charCodeAt(0),
            which: '${char}'.charCodeAt(0),
            code: 'Key${char.toUpperCase()}',
            bubbles: true,
            cancelable: true
          });
          el.dispatchEvent(keyUpEvent);
          
          return true;
        }
        return false;
      })()
    `);
  }
  
  // Trigger change event after typing is done
  await webContents.executeJavaScript(`
    (function() {
      const el = document.querySelector('${selector}');
      if (el) {
        const changeEvent = new Event('change', { bubbles: true });
        el.dispatchEvent(changeEvent);
        return true;
      }
      return false;
    })()
  `);
}

const PAGE_MAP = {
  "Sign in to your Microsoft account": "#usernameTitle",
  "Create a password": "input[type=password]",
  "Date of birth": ["#BirthMonth", "#BirthDay", "#BirthYear"],
  "What's your name?": [
    "input[placeholder*='First name']",
    "input[placeholder*='first name']",
    "#firstNameInput",
    "#lastNameInput",
  ],
  "What's your date of birth?": "#BirthMonth",
  "Microsoft account notice": "#StickyFooter > button",
  "Welcome to Xbox": "#create-account-gamertag-suggestion-1",
  Consent: "#inline-continue-control",
  "Create account": "#liveSwitch",
  "Xbox Official Site: Consoles, Games, and Community | Xbox": "#signup",
  "Add security info": "#hipEnforcementContainer",
};

async function getPage(webContents) {
  try {
    const actualTitle = await execSafe(webContents, "document.title");
    if (
      actualTitle &&
      actualTitle.toLowerCase().includes("create a password")
    ) {
      console.log(
        'Page title indicates "Create a password" — fast-pathing to password page detection',
      );
      return { title: "Create a password", elementInfo: null };
    }
    if (persistedSelectors && persistedSelectors["Create a password"]) {
      try {
        const sel = persistedSelectors["Create a password"];
        const elementInfo = await execSafe(
          webContents,
          `(function(){ try { const el = document.querySelector(${JSON.stringify(sel)}); if(!el) return null; return { id: el.id || null, name: el.name || null, type: el.type || null, placeholder: el.placeholder || null, className: el.className || null, outerHTML: (el.outerHTML||'').slice(0,1000), suggested: ${JSON.stringify(sel)} }; } catch(e){ return null; } })()`,
        );
        if (elementInfo) {
          console.log(
            `Quick-detected password page via persisted selector: ${sel}`,
          );
          return { title: "Create a password", elementInfo };
        }
      } catch (err) {
        console.warn(
          "Quick persisted selector check failed:",
          err && err.message ? err.message : err,
        );
      }
    }

    for (const title of Object.keys(PAGE_MAP)) {
      const selectors = Array.isArray(PAGE_MAP[title])
        ? PAGE_MAP[title]
        : [PAGE_MAP[title]];
      for (const selector of selectors) {
        const elementInfo = await execSafe(
          webContents,
          `(function(){ try { const sel = ${JSON.stringify(selector)}; const el = document.querySelector(sel); if(!el) return null; return { id: el.id || null, name: el.name || null, type: el.type || null, placeholder: el.placeholder || null, className: el.className || null, outerHTML: (el.outerHTML||'').slice(0,1000), suggested: el.id ? ('#' + el.id) : (el.name ? ('input[name=\"' + el.name + '\"]') : sel) }; } catch(e) { return null; } })()`,
        );
        if (elementInfo) {
          console.log(
            `Page detected as "${title}" using selector: ${selector}`,
          );
          if (title === "Create a password") {
            return { title, elementInfo };
          } else {
            return { title, elementInfo: null };
          }
        }
      }
    }

    const hasFirstName = await execSafe(
      webContents,
      `Boolean(document.querySelector('input[placeholder*="First name"]') || document.querySelector('input[placeholder*="first name"]'))`,
    );
    if (hasFirstName) {
      return { title: "What's your name?", elementInfo: null };
    }

    return { title: "Unknown", elementInfo: null };
  } catch (err) {
    console.error("Error in getPage:", err && err.message ? err.message : err);
    return { title: "Unknown", elementInfo: null };
  }
}

(async () => {
  electron.app.on("ready", async () => {
    const mainWindow = new electron.BrowserWindow({
      width: 1000,
      height: 800,
      webPreferences: {
        nodeIntegration: true,
        partition: "persist:main",
      },
    });

    mainWindow.loadURL(
      "https://www.xbox.com/en-CA/auth/msa?action=logIn&returnUrl=https%3A%2F%2Fwww.xbox.com%2Fen-CA%2F",
    );
    mainWindow.webContents.toggleDevTools();

    let lastTitle = null;
    let currentAccount = { email: "", password: "" };

    setInterval(async () => {
      try {
        const { title, elementInfo } = await getPage(mainWindow.webContents);
        if (title === lastTitle || title === "Unknown") return;
        lastTitle = title;
        console.log("Detected page:", title);

        switch (title) {
          case "Xbox Official Site: Consoles, Games, and Community | Xbox":
            mainWindow.loadURL(
              "https://www.xbox.com/en-CA/auth/msa?action=logIn&returnUrl=https%3A%2F%2Fwww.xbox.com%2Fen-CA%2F",
            );
            break;

          case "Sign in to your Microsoft account":
            await new Promise((r) => setTimeout(r, 300));
            await tryMultipleSelectors(
              mainWindow.webContents,
              ["#signup", "#i0116"],
              `document.querySelector('SELECTOR').click()`,
            );
            break;

          case "Create account": {
            const numbers = new Array(10)
              .fill(0)
              .map(() => Math.floor(Math.random() * 10))
              .join("");
            const letters = new Array(5)
              .fill(0)
              .map(() =>
                String.fromCharCode(97 + Math.floor(Math.random() * 26)),
              )
              .join("");
            const email = `${letters}${numbers}@outlook.com`;
            currentAccount.email = email;
            console.log("Created email:", email);

            await execSafe(
              mainWindow.webContents,
              `(function(){ try { const el = document.querySelector('#usernameInput'); if(!el) return false; el.focus && el.focus(); el.click && el.click(); return true; } catch(e){ return false; } })()`,
            );
            await new Promise((r) => setTimeout(r, 150));
            for (let i = 0; i < 30; i++) {
              mainWindow.webContents.sendInputEvent({
                type: "keyDown",
                keyCode: "Backspace",
              });
              mainWindow.webContents.sendInputEvent({
                type: "keyUp",
                keyCode: "Backspace",
              });
            }
            for (const ch of email) {
              mainWindow.webContents.sendInputEvent({
                type: "char",
                keyCode: ch,
              });
            }
            await new Promise((r) => setTimeout(r, 150));
            await execSafe(
              mainWindow.webContents,
              `(function(){ try { const btn = document.querySelector('#nextButton'); if(!btn) return false; btn.click && btn.click(); return true; } catch(e){ return false; } })()`,
            );
            console.log("Submitted email");
            break;
          }

          case "Date of birth": {
            const currentYear = new Date().getFullYear();
            const birthYear = Math.floor(Math.random() * (currentYear - 18 - (currentYear - 65) + 1)) + (currentYear - 65);
            const birthMonth = String(Math.floor(Math.random() * 12) + 1).padStart(2, '0');
            const birthDay = String(Math.floor(Math.random() * 28) + 1).padStart(2, '0');
            await simulateTyping(mainWindow.webContents, '#BirthMonth', birthMonth);
            await new Promise(r => setTimeout(r, 300 + Math.random() * 500));
            await simulateTyping(mainWindow.webContents, '#BirthDay', birthDay);
            await new Promise(r => setTimeout(r, 300 + Math.random() * 500));
            await simulateTyping(mainWindow.webContents, '#BirthYear', birthYear.toString());
            await new Promise(r => setTimeout(r, 300 + Math.random() * 500));
            await execSafe(
              mainWindow.webContents,
              `(function(){
                try {
                  const btn = document.querySelector('input[type="submit"], button[type="submit"], #idSIButton9, #idA_PWD_ForgotPassword, #idA_IL_ForgotPassword0, #idA_IL_SignInAnotherWay, #idA_SignUpNow, #idA_Nevermind, #idA_BackToSignin, #idA_BackToSigninLink, #idA_BackToProofs, #idA_BackToProofsLink, #idA_BackToPhoneVerification, #idA_BackToPhoneVerificationLink, #idA_BackToEmailVerification, #idA_BackToEmailVerificationLink, #idA_BackToPhoneFactorVerification, #idA_BackToPhoneFactorVerificationLink, #idA_BackToEmailFactorVerification, #idA_BackToEmailFactorVerificationLink, #idA_BackToPhoneFactor, #idA_BackToPhoneFactorLink, #idA_BackToEmailFactor, #idA_BackToEmailFactorLink, #idA_BackToPhoneFactorVerification, #idA_BackToPhoneFactorVerificationLink, #idA_BackToEmailFactorVerification, #idA_BackToEmailFactorVerificationLink, #idA_BackToPhoneFactor, #idA_BackToPhoneFactorLink, #idA_BackToEmailFactor, #idA_BackToEmailFactorLink, #idA_BackToPhoneVerification, #idA_BackToPhoneVerificationLink, #idA_BackToEmailVerification, #idA_BackToEmailVerificationLink, #idA_BackToProofs, #idA_BackToProofsLink, #idA_BackToSignin, #idA_BackToSigninLink, #idA_Nevermind, #idA_SignUpNow, #idA_IL_SignInAnotherWay, #idA_IL_ForgotPassword0, #idA_PWD_ForgotPassword, #idSIButton9');
                  if (btn) {
                    btn.click();
                    return true;
                  }
                  return false;
                } catch (e) {
                  console.error('Error clicking next button:', e);
                  return false;
                }
              })()`
            );
            console.log("Submitted date of birth");
            break;
          }

          case "Create a password": {
            if (elementInfo && elementInfo.suggested) {
              try {
                persistSelector("Create a password", elementInfo.suggested);
                persistedSelectors["Create a password"] = elementInfo.suggested;
              } catch (err) {
                console.warn(
                  "Persist selector error:",
                  err && err.message ? err.message : err,
                );
              }
            }

            const password = [2, 2, 2, 2]
              .map((len, idx) => {
                if (idx === 0)
                  return new Array(len)
                    .fill(0)
                    .map(() =>
                      String.fromCharCode(97 + Math.floor(Math.random() * 26)),
                    )
                    .join("");
                if (idx === 1)
                  return new Array(len)
                    .fill(0)
                    .map(() =>
                      String.fromCharCode(65 + Math.floor(Math.random() * 26)),
                    )
                    .join("");
                if (idx === 2)
                  return new Array(len)
                    .fill(0)
                    .map(() => `${Math.floor(Math.random() * 10)}`)
                    .join("");
                return new Array(len)
                  .fill(0)
                  .map(() =>
                    String.fromCharCode(33 + Math.floor(Math.random() * 15)),
                  )
                  .join("");
              })
              .join("");
            currentAccount.password = password;
            console.log("Created password:", password);

            const persistedSel =
              persistedSelectors["Create a password"] ||
              "#Password" ||
              "input[type=password]";

            const fillAttemptScript = `(async function(){
              try {
                const sel = ${JSON.stringify(persistedSel)};
                const val = ${JSON.stringify(password)};
                const start = Date.now();
                function setNativeValue(el, v) {
                  try {
                    const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
                    if (desc && desc.set) {
                      desc.set.call(el, v);
                    } else {
                      el.value = v;
                    }
                    try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch(e){}
                    try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch(e){}
                  } catch(e){}
                }
                while (Date.now() - start < 600) {
                  const el = document.querySelector(sel);
                  if (el) {
                    try {
                      el.focus && el.focus();
                      setNativeValue(el, val);
                    } catch(e){}
                    return true;
                  }
                  await new Promise(r => setTimeout(r, 40));
                }
                return false;
              } catch(e) { return false; }
            })()`;

            let filled = false;
            try {
              filled =
                !!(await mainWindow.webContents.executeJavaScript(
                  fillAttemptScript,
                ));
            } catch (err) {
              console.warn(
                "fast fill script failed:",
                err && err.message ? err.message : err,
              );
              filled = false;
            }

            if (!filled) {
              console.log(
                "Fast fill did not find element; injecting MutationObserver as a faster background fill",
              );

              const observerScript = `(function(){
                try {
                  const sel = ${JSON.stringify(persistedSel)};
                  const val = ${JSON.stringify(password)};
                  let done = false;
                  function setNativeValue(el, v) {
                    try {
                      const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
                      if (desc && desc.set) {
                        desc.set.call(el, v);
                      } else {
                        el.value = v;
                      }
                      try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch(e){}
                      try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch(e){}
                    } catch(e){}
                  }
                  function tryFill() {
                    if (done) return false;
                    try {
                      const el = document.querySelector(sel);
                      if (el) {
                        try {
                          el.focus && el.focus();
                          setNativeValue(el, val);
                        } catch(e){}
                        done = true;
                        return true;
                      }
                    } catch(e){}
                    return false;
                  }
                  // try immediately in case element is already present
                  if (tryFill()) return true;
                  const observer = new MutationObserver(function(mutations){
                    if (tryFill()) {
                      try { observer.disconnect(); } catch(e){}
                    }
                  });
                  observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
                  // fallback timer to stop observing if nothing appears in 4s
                  setTimeout(function(){ try { observer.disconnect(); } catch(e){} }, 4000);
                  return true;
                } catch(e) { return false; }
              })();`;
              try {
                await execSafe(mainWindow.webContents, observerScript);
              } catch (err) {
                console.warn(
                  "MutationObserver injection failed:",
                  err && err.message ? err.message : err,
                );
              }

              await new Promise((r) => setTimeout(r, 300));

              try {
                const finalValue = await execSafe(
                  mainWindow.webContents,
                  `(function(){ try { const el = document.querySelector(${JSON.stringify(persistedSel)}); return el ? el.value : null; } catch(e){ return null; } })()`,
                );
                if (finalValue && finalValue.trim() !== "") {
                  filled = true;
                }
              } catch (err) {}
            }

            if (!filled) {
              console.log(
                "Observer did not fill the field; falling back to typing approach",
              );
              await waitForElementAndExecute(
                mainWindow.webContents,
                persistedSel,
                `(function(){ const el = document.querySelector(${JSON.stringify(persistedSel)}); if(!el) return false; try{ el.focus(); el.click(); } catch(e){} return true; })()`,
                6,
              );
              for (let i = 0; i < 30; i++) {
                mainWindow.webContents.sendInputEvent({
                  type: "keyDown",
                  keyCode: "Backspace",
                });
                mainWindow.webContents.sendInputEvent({
                  type: "keyUp",
                  keyCode: "Backspace",
                });
              }
              for (const ch of password) {
                mainWindow.webContents.sendInputEvent({
                  type: "char",
                  keyCode: ch,
                });
                await new Promise((r) => setTimeout(r, 25));
              }
            }

            await new Promise((r) => setTimeout(r, 180));
            try {
              const finalValue = await execSafe(
                mainWindow.webContents,
                `(function(){ try { const el = document.querySelector(${JSON.stringify(persistedSel)}); return el ? el.value : null; } catch(e){ return null; } })()`,
              );
              console.log(
                "Final password value before Next:",
                finalValue ? "[HIDDEN]" : "EMPTY",
              );
            } catch (err) {
              console.warn(
                "Could not read final password value:",
                err && err.message ? err.message : err,
              );
            }

            await waitForElementAndExecute(
              mainWindow.webContents,
              "#nextButton",
              `(function(){ const btn = document.querySelector('#nextButton'); if(!btn) return false; try{ btn.click(); } catch(e){} return true; })()`,
              4,
            );
            break;
          }

          case "What's your name?": {
            console.log(
              "Name page detected - inspecting DOM and filling names",
            );
            await inspectDOM(mainWindow.webContents);

            const firstNames = [
              "Alex",
              "Jordan",
              "Taylor",
              "Casey",
              "Riley",
              "Morgan",
              "Avery",
              "Quinn",
              "Sage",
              "River",
              "Ichigo",
            ];
            const lastNames = [
              "Smith",
              "Johnson",
              "Brown",
              "Davis",
              "Miller",
              "Wilson",
              "Moore",
              "Taylor",
              "Anderson",
              "Thomas",
              "Kurosaki",
            ];
            const first =
              firstNames[Math.floor(Math.random() * firstNames.length)];
            const last =
              lastNames[Math.floor(Math.random() * lastNames.length)];
            console.log("Generated names:", first, last);

            await waitForElementAndExecute(
              mainWindow.webContents,
              "#firstNameInput",
              `(function(){ const el = document.querySelector('#firstNameInput'); if(!el) return false; try{ el.focus(); el.click(); }catch(e){} return true; })()`,
              4,
            );
            await new Promise((r) => setTimeout(r, 180));
            for (let i = 0; i < 15; i++) {
              mainWindow.webContents.sendInputEvent({
                type: "keyDown",
                keyCode: "Backspace",
              });
              mainWindow.webContents.sendInputEvent({
                type: "keyUp",
                keyCode: "Backspace",
              });
            }
            for (const ch of first) {
              mainWindow.webContents.sendInputEvent({
                type: "char",
                keyCode: ch,
              });
              await new Promise((r) => setTimeout(r, 30));
            }
            await new Promise((r) => setTimeout(r, 180));
            mainWindow.webContents.sendInputEvent({
              type: "keyDown",
              keyCode: "Tab",
            });
            mainWindow.webContents.sendInputEvent({
              type: "keyUp",
              keyCode: "Tab",
            });
            await new Promise((r) => setTimeout(r, 120));
            for (const ch of last) {
              mainWindow.webContents.sendInputEvent({
                type: "char",
                keyCode: ch,
              });
              await new Promise((r) => setTimeout(r, 30));
            }
            await new Promise((r) => setTimeout(r, 200));
            mainWindow.webContents.sendInputEvent({
              type: "keyDown",
              keyCode: "Return",
            });
            mainWindow.webContents.sendInputEvent({
              type: "keyUp",
              keyCode: "Return",
            });
            await new Promise((r) => setTimeout(r, 400));
            await waitForElementAndExecute(
              mainWindow.webContents,
              "#nextButton",
              `document.querySelector('#nextButton').click()`,
              4,
            );
            break;
          }

          case "What's your date of birth?": {
            await tryMultipleSelectors(
              mainWindow.webContents,
              ["#BirthMonth", "#BirthMonthDropdown"],
              `document.querySelector('SELECTOR').value = "${Math.max(1, Math.floor(Math.random() * 12))}";`,
            );
            await new Promise((r) => setTimeout(r, 180));
            await tryMultipleSelectors(
              mainWindow.webContents,
              ["#BirthMonth", "#BirthMonthDropdown"],
              `document.querySelector('SELECTOR').dispatchEvent(new Event("change"));`,
            );
            await new Promise((r) => setTimeout(r, 240));
            await tryMultipleSelectors(
              mainWindow.webContents,
              ["#BirthDay", "#BirthDayDropdown"],
              `document.querySelector('SELECTOR').value = "${Math.max(1, Math.floor(Math.random() * 15))}";`,
            );
            await new Promise((r) => setTimeout(r, 160));
            await tryMultipleSelectors(
              mainWindow.webContents,
              ["#BirthDay", "#BirthDayDropdown"],
              `document.querySelector('SELECTOR').dispatchEvent(new Event("change"));`,
            );
            await new Promise((r) => setTimeout(r, 200));
            await tryMultipleSelectors(
              mainWindow.webContents,
              ["#BirthYear", "#BirthYearDropdown"],
              `document.querySelector('SELECTOR').value = "1995";`,
            );
            await new Promise((r) => setTimeout(r, 160));
            await tryMultipleSelectors(
              mainWindow.webContents,
              ["#BirthYear", "#BirthYearDropdown"],
              `document.querySelector('SELECTOR').dispatchEvent(new Event("input"));`,
            );
            await new Promise((r) => setTimeout(r, 300));
            await waitForElementAndExecute(
              mainWindow.webContents,
              "#nextButton",
              `document.querySelector('#nextButton').click()`,
              4,
            );
            break;
          }

          case "Microsoft account notice": {
            await new Promise((r) => setTimeout(r, 200));
            await tryMultipleSelectors(
              mainWindow.webContents,
              ["#StickyFooter > button", "#idSubmit_SAOTCS_Confirm"],
              `document.querySelector('SELECTOR').click()`,
            );
            break;
          }

          case "Welcome to Xbox": {
            appendFileSync(
              ACCOUNTS_FILE,
              `${currentAccount.email}:${currentAccount.password}\n`,
            );
            console.log(
              "Account created:",
              `${currentAccount.email}:${currentAccount.password}`,
            );
            await new Promise((r) => setTimeout(r, 300));
            await tryMultipleSelectors(
              mainWindow.webContents,
              [
                "#create-account-gamertag-suggestion-1",
                "#create-account-gamertag-suggestion-2",
              ],
              `document.querySelector('SELECTOR').click()`,
            );
            await new Promise((r) => setTimeout(r, 300));
            await tryMultipleSelectors(
              mainWindow.webContents,
              ["#inline-continue-control", "#idSubmit_SAOTCS_Confirm"],
              `document.querySelector('SELECTOR').click()`,
            );
            break;
          }

          case "Consent": {
            await tryMultipleSelectors(
              mainWindow.webContents,
              ["#inline-continue-control", "#idSubmit_SAOTCS_Confirm"],
              `document.querySelector('SELECTOR').click()`,
            );
            break;
          }

          default:
            console.log("Unhandled page:", title);
            break;
        }
      } catch (err) {
        console.error(
          "Main loop error:",
          err && err.message ? err.message : err,
        );
      }
    }, 120);
  });
})().catch((err) => {
  console.error("Application error:", err && err.message ? err.message : err);
});
