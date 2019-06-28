const CHECKSUM_TYPE_MD5 = 'md5';
const CHECKSUM_TYPE_SHA1 = 'sha1';
const CHECKSUM_TYPE_SHA256 = 'sha256';
const CHECKSUM_TYPE_SHA384 = 'sha384';
const CHECKSUM_TYPE_SHA512 = 'sha512';

// Remove all previous alarms when a new background is started
chrome.alarms.clearAll();

/**
 * Verify if extension install is correct. If URL file access is not allowed, instructions are displayed in a new tab
 */
chrome.extension.isAllowedFileSchemeAccess(function (isAllowed) {
    if (!isAllowed) {
        chrome.tabs.create({url: chrome.extension.getURL("settings/" + chrome.i18n.getMessage("lang") + "/instructions.html")}, function () {
        })
    }
});

// Array containing all possible dangerous urls
let linkToMonitor = [];

/**
 * Listen to messages coming from content script
 */
chrome.runtime.onMessage.addListener(function (request, sender) {
    switch (request.type) {
        // A page with checksum and algo name has benn open all links are registered
        case "download":
            let tab = parseInt(sender.tab.id);

            linkToMonitor.unshift({
                request: request,
                urls: request.urls,
                checksum: request.checksum,
                tab: tab
            });

            break;
        // The delete link has been clicked on the popup
        case "remove":
            console.debug("asked to remove");
            //delete file
            chrome.downloads.removeFile(request.id);
            // Update popup warning
            chrome.tabs.sendMessage(sender.tab.id, {type: "deleted"});
            break;
        // A page containing checksums algo names and links to monitor has been notices, it will keep the background script running
        case "keepAlive":
            console.debug("Content request to keep alive");
            break;
        default:
            console.debug("Unknown request type: " + request.type);
            break;
    }

});

/******************************************************************************
 * Monitor downloads in order to share the user behaviour (try catch block)
 * Take care of launching checksum computation
 ******************************************************************************/
let downloads = {};

//Stop download on create, verify if download is dangerous complete dictionnary of dangerous download
chrome.downloads.onCreated.addListener(function (downloadItem) {
    console.debug(downloadItem);
    for (let link of linkToMonitor) {
        if (link.urls.includes(downloadItem.url) || link.urls.includes(downloadItem.finalUrl)) {
            downloads[downloadItem.id] = {
                download: downloadItem.url,
                checksum: link.checksum,
                tab: link.tab,
                completed: false
            };
            chrome.tabs.sendMessage(link.tab, {type: "downloading"});
            keepAlive();
            break;

        }
    }


});

chrome.downloads.onChanged.addListener(function (download) {
    if (!(download.id in downloads)) {
        // the download was not registered (i.e., wasn't triggered from a download link detected by the ext)
        return;
    }
    //Store the download id
    let tab = downloads[download.id].tab;

    // Register the local filename of the download
    if (download.filename) {
        downloads[download.id].filename = "file://" + download.filename.current;
    }
    // Compute the checksum of the downloaded file
    if (download.state && download.state.current === 'complete') {
        downloads[download.id].completed = true;
        // Send message to tab to display the computation
        chrome.tabs.sendMessage(tab, {type: "computing"});

        // Create a request to load downloaded file
        const xhr = new XMLHttpRequest();
        xhr.responseType = 'arraybuffer';
        // Send the request to read the local (downloaded file)
        console.debug(downloads[download.id].filename);
        xhr.open("GET", downloads[download.id].filename, true);

        // Start checksum computing
        xhr.addEventListener("load", computeChecksum);

        // Send an error message to the tab that created the download request
        xhr.addEventListener("error", function () {
            console.debug("An error occured while accessing the downloaded file");
            chrome.tabs.sendMessage(tab, {
                type: "error",
                message: "An error occured while accessing the downloaded file"
            });
            delete downloads[download.id];

        });

        xhr.send();


        /**
         * Computes checksums for the downloaded file and compare with checksums found on the page triggering the download.
         *
         * @returns {Promise<void>}
         */
        async function computeChecksum() {
            console.debug("Entering computeChecksum");

            const checksum = downloads[download.id].checksum;
            // noinspection Annotator
            const checksum_types = checksum.type;
            const checksum_value_actual = new Set(checksum.value);
            const checksum_value_computed = new Set();

            let checksum_result;

            for (let checksum_type of checksum_types) {
                switch (checksum_type.toLowerCase().replace('-', '')) {
                    case CHECKSUM_TYPE_MD5:
                        console.debug("md5");
                        checksum_result = md5.hex(xhr.response);
                        break;
                    case CHECKSUM_TYPE_SHA1:
                        console.debug("sha1");
                        checksum_result = await hash("SHA-1", xhr.response);
                        break;
                    case CHECKSUM_TYPE_SHA256:
                        console.debug("sha2");
                        checksum_result = await hash("SHA-256", xhr.response);
                        break;
                    case CHECKSUM_TYPE_SHA384:
                        console.debug("sha384");
                        checksum_result = await hash("SHA-384", xhr.response);
                        break;
                    case CHECKSUM_TYPE_SHA512:
                        console.debug("sha512");
                        checksum_result = await hash("SHA-512", xhr.response);
                        break;
                    default:
                        console.debug("An error has occured while computing the checksum: Unknown checksum type '" + checksum_type + "'");
                        continue;
                }
                checksum_value_computed.add(checksum_result);

            }

            const valid = new Set([...checksum_value_computed].filter(x => checksum_value_actual.has(x))).size > 0;

            // Send end of computation and result to tab
            chrome.tabs.sendMessage(tab, {
                type: "verifying",
                valid: valid,
                checksum_value_actual: [...checksum_value_actual],
                checksum_value_computed: [...checksum_value_computed],
                id: download.id,
            });

            delete downloads[download.id];
        }
    } else if (download.state && download.state.current === 'interrupted') {
        delete downloads[download.id];
    }
});


// Compute SHA digest for the downloaded file
function hash(algo, buffer) {
    return crypto.subtle.digest(algo, buffer).then(function (hash) {
        return Array.from(new Uint8Array(hash)).map(b => ('00' + b.toString(16)).slice(-2)).join('');
    });
}

function keepAlive() {
    console.debug("Background request to keep alive");
    chrome.alarms.create("keepAlive", {when: Date.now() + 1000});
}

// Keep alive the background script as long as there is download to monitor.
chrome.alarms.onAlarm.addListener(function (alarm) {
    let completed = true;
    // Verify that all downloads are completed
    for (let key in downloads) {
        completed = completed && downloads[key].completed;
    }

    // if a keep alive alarm was received an not all dangerous download are finished, keep alive for one more second
    if (alarm.name === "keepAlive" && !completed) {
        keepAlive();
    }
});
