const REGEXP_CHECKSUM_VALUE = /(?:[a-f0-9]{32,}|[A-F0-9]{32,})/g;
const CHECKSUM_VALUE_SIZE = [32, 40, 56, 64, 96, 128];
const REGEXP_CHECKSUM_ALGO = /((sha|SHA)(-)?(1|256|2|384|512)|((md|MD)5))/g;
const DANGEROUS_EXTENSIONS = ["dmg", "exe", "msi", "pkg", "iso", "zip", "tar.xz", "tar.gz", "tar.bz2", "tar", "deb", "rpm"];

const MSG_HIDE = '<span id="msg_hide" style="width: 100%; float: right;"><i class="fas fa-times" style="color: rgb(95, 99, 105);"></i></span>';
const CLASS_HIGHLIGHTED_CHECKSUM = "highlighted_checksum";

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


let checksumValues = [];
let checksumAlgos = [];

/**
 * Extract pattern from a DOM element.
 *
 * @param elem          HTML Node to start the research.
 * @param pattern       Regex to find in node.
 * @param root          Used for the recursion.
 * @returns {Set<string>}  Set of element(s) matching the pattern
 */
function extractPattern(elem, pattern, root = false) {
    try {
        let checksumValues = new Set();
        if (elem.children.length === 0 || root) {
            if (elem.nodeName !== "SCRIPT" &&
                elem.nodeName !== "STYLE" &&
                elem.nodeName !== "NOSCRIPT"
            ) {
                while ((r = pattern.exec(elem.innerText)) !== null) {
                    checksumValues.add(r[0].toLowerCase().replace('-', ''));
                }
            }
        }
        for (child of elem.children) {
            for (c of extractPattern(child, pattern)) {
                checksumValues.add(c);
            }
        }
        return checksumValues;
    } catch (e) {
        console.debug("Error in reading inner text of element. \n" +
            "Error: " + e.toString());
        return new Set()

    }

}

function diversity(checksum, limit) {
    let set = new Set();
    for (char of checksum) {
        set.add(char);
    }

    return (set.size > limit);
}

function hasMix(elem) {
    const letters = /([a-f]|[A-F])/;
    const numbers = /([0-9])/;
    return letters.test(elem) && numbers.test(elem);
}

function filter(set) {
    const checksumValues = new Set();
    for (let elem of set) {
        if (CHECKSUM_VALUE_SIZE.includes(elem.length)) {
            if (hasMix(elem)) {
                if (diversity(elem, 10)) {
                    checksumValues.add(elem)
                }
            }
        }
    }
    return checksumValues
}

/**
 * Detect checksums and algo names on webpage
 *
 * @returns {Promise<void>}
 */
async function checksumFunction() {
    //Arbitrary sleep to allows other js to load elements
    await sleep(200);
    // Detect checksum values in the page
    checksumValues = filter(extractPattern(document.body, REGEXP_CHECKSUM_VALUE, true));
    // Detect checksum algorithms in the page
    checksumAlgos = extractPattern(document.body, REGEXP_CHECKSUM_ALGO, true);

    console.debug(checksumValues);
    console.debug(checksumAlgos);
}

checksumFunction();


function isExtensionDangerous(filename) {
    return DANGEROUS_EXTENSIONS.reduce((acc, x) => acc || filename.endsWith(x), false);
}


/**
 * Find all link that are potentially dangerous and if there is checksums and algo names on the page, send info to background.
 *
 * @returns {Promise<void>}
 */
async function linkToMonitor() {
    // Wait for site JS to load all content
    await sleep(300);
    if (checksumValues.size !== 0) {
        let urls = [];

        document.querySelectorAll("a").forEach(function (link) {

            if (link.hasAttribute("href") && isExtensionDangerous(link.href)) {
                // Send a download request to the background process based on the content type
                urls.push(link.href)

            }
        });
        if (urls.length !== 0) {
            checksum = {
                type: [...checksumAlgos],
                value: [...checksumValues],
            };

            chrome.runtime.sendMessage({
                type: "download",
                urls: [...urls],
                checksum: checksum,
            });

            //keep background script open 2 min after checksum found on page
            let i = 0;
            while (i < 120) {
                await sleep(1000);
                chrome.runtime.sendMessage({type: "keepAlive"});
                i++;
            }
        }

    }

}

linkToMonitor();


/******************************************************************************
 * Create shadow DOM to display popup
 ******************************************************************************/

let mask_ = document.createElement("div");
let shadow = mask_.attachShadow({mode: 'open'});

let mask = document.createElement("div");
mask.id = 'mask';
mask.style.display = 'none';

let style = document.createElement('style');
fetch(chrome.runtime.getURL('css/bootstrap.min.css'), {method: 'GET'}).then(response => response.text().then(data => style.textContent += data));
fetch(chrome.runtime.getURL('css/style.css'), {method: 'GET'}).then(response => response.text().then(data => style.textContent += data));
fetch(chrome.runtime.getURL('css/fontawesome-all.css'), {method: 'GET'}).then(response => response.text().then(data => style.textContent += data));

shadow.appendChild(style);

let popup = document.createElement("div");
popup.id = 'popup';

let popup_head = document.createElement("div");
popup_head.style.width = "100%";
popup_head.style.height = "20px";

let unil_logo = document.createElement("img");
const unil_logo_size = "16px";
unil_logo.classList.add("rounded");
unil_logo.alt = "Unil logo";
unil_logo.style.cssFloat = "left";
unil_logo.src = chrome.runtime.getURL('icons/unil-favicon.ico');
unil_logo.style.height = unil_logo_size;
unil_logo.style.width = unil_logo_size;

let hide_link = document.createElement("a");
hide_link.style.cssFloat = "right";
hide_link.id = 'hide';
hide_link.href = '#';
hide_link.innerHTML = MSG_HIDE;
hide_link.onclick = makeHideFunction(mask);

popup_head.appendChild(unil_logo);
popup_head.appendChild(hide_link);

let title = document.createElement("div");
title.className = 'title';
title.innerHTML = chrome.i18n.getMessage("contentPopupTitle");

let content = document.createElement("div");
content.className = 'content';
content.innerHTML = '<p id="details"><p><p id="status">' +
    chrome.i18n.getMessage("contentPopupStatus") +
    '<img src="' + chrome.extension.getURL("icons/icon16.png") + '" alt="Icon of the plugin"></p>';

popup.appendChild(popup_head);
popup.appendChild(title);
popup.appendChild(content);

mask.appendChild(popup);
shadow.appendChild(mask);
try {
    document.body.appendChild(mask_);
} catch (e) {
    console.debug("Error in appending shadow DOM: " + e.toString());
}


/******************************************************************************
 * Display info in window
 ******************************************************************************/

// Highlight checksum in webpage
function highlightPattern(elem, pattern) {
    for (child of elem.children) {
        highlightPattern(child, pattern);
    }
    if (elem.children.length === 0) {
        innerHTML = elem.innerHTML;
        elem.innerHTML = elem.innerHTML.replace(pattern, x => '<span class=' + CLASS_HIGHLIGHTED_CHECKSUM + '>' + x + '</span>');
        if (innerHTML !== elem.innerHTML) { //replace has modified the element (i.e., it contains the checksum)
            makeVisible(elem);
        }
    }
}

// Remove highlighting tags
function cancelHighlight(elem = document.body) {
    for (child of elem.children) {
        cancelHighlight(child);
    }
    if (elem.className === CLASS_HIGHLIGHTED_CHECKSUM) {
        elem.className = '';
    }
}

function makeVisible(elem) {
    if (window.getComputedStyle(elem).display === 'none') {
        elem.style.display = 'initial';
    }
    if (elem.parentElement !== null) {
        makeVisible(elem.parentElement);
    }
}

function makeHideFunction(e) {
    return function () {
        e.style.display = 'none';
        cancelHighlight();
        return false;
    }
}

// Send request to background to delete downloaded file
function deleteFile(id) {
    chrome.runtime.sendMessage({
        type: "remove",
        id: id
    });
}


// Listen to the background process
chrome.runtime.onMessage.addListener(function (request) {
    let mask = shadow.getElementById('mask');
    let status = shadow.getElementById('status');

    switch (request.type) {
        case "downloading":
            cancelHighlight();
            title.innerHTML = chrome.i18n.getMessage("popupTitle");
            status.innerHTML = chrome.i18n.getMessage("popupDetails") + chrome.i18n.getMessage("popupStatusDownloading");
            mask.style.display = 'block';
            break;
        case "computing":
            title.innerHTML = chrome.i18n.getMessage("popupTitle");
            status.innerHTML = chrome.i18n.getMessage("popupDetails") + chrome.i18n.getMessage("popupStatusComputing");
            mask.style.display = 'block';
            break;
        case "verifying":
            if (request.valid) {
                highlightPattern(document.body, new RegExp(request.checksum_value_computed.join('|'), "gi"));
                title.innerHTML = chrome.i18n.getMessage("contentPopupTitleSafe");
                status.innerHTML = chrome.i18n.getMessage("popupStatusValid");
            } else {
                title.innerHTML = chrome.i18n.getMessage("contentPopupTitleUnsafe");
                status.innerHTML = chrome.i18n.getMessage("popupStatusInvalid");
                //shadow.getElementById("adanger").onclick = openPrivateTab;
                shadow.getElementById("delete").onclick = function () {
                    deleteFile(request.id)
                };
            }
            mask.style.display = 'block';
            break;
        case "deleted":
            status.innerHTML = chrome.i18n.getMessage("popupStatusDeleted");
            mask.style.display = 'block';
            break;
        case "error":
            console.debug("Error: " + request.message);
            break;
        default:
            console.debug("Unknown message: " + request.type);
            return;
    }
});


