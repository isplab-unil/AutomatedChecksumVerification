
MSG_DETAILS_INTEGRITY_TAG = 'The link you clicked on has trigerred a download and a checksum was specified in the link. Once the download is complete, the dowloaded file will be checked against the specified checksum and you will be notified of the result. <a href="https://gnupg.org/download/integrity_check.html" target="_blank">Learn more</a>.';
MSG_DETAILS_PAGE_TEXT = 'The link you clicked on has trigerred a download and checksums were found on the webpage. Once the download is complete, the dowloaded file will be checked against the found checksums and you will be notified of the result. <a href="https://gnupg.org/download/integrity_check.html" target="_blank">Learn more</a>.';
MSG_DOWNLOADING = "<i class='fas fa-download'></i> Downloading... <i class='fa fa-spinner fa-spin'></i>";
MSG_COMPUTING = "<i class='fas fa-cogs'></i> Computing checksum... <i class='fa fa-spinner fa-spin'></i>";
MSG_VERIFICATION_VALID_INTEGRITY_TAG = "<i class='fas fa-shield-alt' style='color: green;'></i> The checksum computed from the dowloaded file matches that specified in the download link.";
MSG_VERIFICATION_INVALID_INTEGRITY_TAG = "<i class='fas fa-exclamation-triangle' style='color: red;'></i> The checksum computed from the downloaded file does not match that specified in the download link. This means that the file has been corrupted and that it could harm your computer. It is strongly recommended to <a href='#' id='delete'>delete</a> the downloaded file and contact the site's webmaster.";
MSG_VERIFICATION_VALID_PAGE_TEXT = "<i class='fas fa-shield-alt' style='color: lightgreen;'></i> The checksum computed from the dowloaded file matches one of the checksums found on the webpage. ";
MSG_VERIFICATION_INVALID_PAGE_TEXT = "<i class='fas fa-exclamation-triangle' style='color: orange;'></i> The checksum computed from the downloaded file does not match any of the checksums found on the webpage. This means that either the file has been corrupted or that the checksums specified on the webpage correspond to other files. If you suspect the downloaded file has been corrupted, <a id='delete' href='#'>delete</a> it and contact the site's webmaster.";
MSG_ERROR = "Error: ";

// DANGEROUS_EXTENSIONS = ["dmg", "exe", "iso", "msi", "tar.gz", "tar.xz", "zip"];
DANGEROUS_EXTENSIONS = ["dmg", "exe", "msi", "tar.xz", "zip"];

REGEXP_CHECHSUM_INTEGRITY_TAG = /^(md5|sha1|sha256)\-((?:[A-F0-9]|[a-f0-9]){32,})$/;
REGEXP_CHECKSUM_VALUE = /(?:[a-f0-9]|[A-F0-9]){32,}/g;
REGEXP_CHECKSUM_ALGO = /((sha|SHA)(-)?(1|256)|((md|MD)5))/g;

ORIGIN_INTEGRITY_TAG = "integrity_tag";
ORIGIN_PAGE_TEXT = "page_text";

CLASS_HIGHLIGHTED_CHECKSUM = "highlighted_checksum";

function createId(id) {
    return id;
}

function isExtensionDangerous(filename) {
    return DANGEROUS_EXTENSIONS.reduce((acc, x) => acc || filename.endsWith(x), false);
}

function extractPattern(elem, pattern, root = false) {
    var checksum_values = new Set();
    if (elem.children.length == 0 || root) {
        while ((r = pattern.exec(elem.innerText)) !== null) {
            checksum_values.add(r[0].toLowerCase().replace('-', ''));
        }
    }
    for (child of elem.children) {
        for (c of extractPattern(child, pattern)) {
            checksum_values.add(c);
        }
    }
    // console.log(elem + ": " + [...checksum_values])
    return checksum_values;
}

function highlightPattern(elem, pattern) {
    for (child of elem.children) {
        highlightPattern(child, pattern);
    }
    if (elem.children.length == 0) {
        innerHTML = elem.innerHTML;
        elem.innerHTML = elem.innerHTML.replace(pattern, x => '<span class=' + CLASS_HIGHLIGHTED_CHECKSUM + '>' + x + '</span>');
        if (innerHTML !== elem.innerHTML) { //replace has modified the element (i.e., it contains the checksum)
            makeVisible(elem);
        }
    }
}

function cancelHighlight(elem = document.body) {
    for (child of elem.children) {
        cancelHighlight(child);
    }
    if (elem.className == CLASS_HIGHLIGHTED_CHECKSUM) {
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

function makeRemoveDownloadedFile(id) {
    return function() {
        chrome.runtime.sendMessage({
            type: "remove",
            id: id
        });
        return false;
    }
}

function makeHideFunction(e) {
    return function() {
        e.style.display = 'none';
        cancelHighlight();
        return false;
    }
}

// Modifies all the iframes to prevent automatic download; doesn't really work (I guess it's executed "too late")
document.querySelectorAll("iframe").forEach(function(iframe) {
    if (iframe.hasAttribute('src') && isExtensionDangerous(iframe.src)) {
        iframe.src = '';
        // alternatively: trigger the download (if checksums and algorithms are found on the webpage)
        // 
    }
});

// Modifies all the links
document.querySelectorAll("a").forEach(function(link) {
    link.addEventListener("click", function(event) {
        //var element = event.toElement;
        var element = link;
        var checksum;

        if (element.hasAttribute("integrity")) {
            var r = REGEXP_CHECHSUM_INTEGRITY_TAG.exec(element.getAttribute("integrity"));

            // Return if the integrity tag is malformed
            if (r === null) {
                return false;
            }
            checksum = {
                type: [r[1]],
                value: [r[2]],
                origin: ORIGIN_INTEGRITY_TAG
            }
        } else if (element.hasAttribute("href") && isExtensionDangerous(element.href)) {
            // Detect checksum values in the page
            var checksum_values = extractPattern(document.body, REGEXP_CHECKSUM_VALUE, true);

            // Detect checksum algorithms in the page
            var checksum_algos = extractPattern(document.body, REGEXP_CHECKSUM_ALGO, true);

            // Return if no checksums and algorithms are found
            if (checksum_values.size == 0 || checksum_algos.size == 0) {
                return false;
            }
            checksum = {
                type: [...checksum_algos],
                value: [...checksum_values],
                origin: ORIGIN_PAGE_TEXT
            };

        } else {
            // Return otherwise
            return false;
        }

        // Stop the propagation of the click event
        event.preventDefault();

        // Send a download request to the background process
        chrome.runtime.sendMessage({
            type: "download",
            download: element.href,
            checksum: checksum
        });

        return false;
    });
});

var mask_ = document.createElement("div");
var shadow = mask_.attachShadow({mode: 'open'});

var mask = document.createElement("div");
mask.id = createId('mask');
mask.style.display = 'none';

var style = document.createElement('style');
fetch(chrome.runtime.getURL('css/style.css'), {method: 'GET'}).then(response => response.text().then(data => style.textContent += data));
fetch(chrome.runtime.getURL('css/fontawesome-all.css'), {method: 'GET'}).then(response => response.text().then(data => style.textContent += data));

shadow.appendChild(style);

var popup = document.createElement("div");
popup.id = createId('popup');
popup.innerHTML = '<div class="title"><i class="far fa-arrow-alt-circle-down"></i> Checksum verifier</div><p id="details"><p><p id="' + createId('status') + '"></p>';

var hide_link = document.createElement("a");
hide_link.id = createId('hide');
hide_link.href = '#';
hide_link.innerText = 'Hide';
hide_link.onclick = makeHideFunction(mask);

popup.appendChild(hide_link);
mask.appendChild(popup);
shadow.appendChild(mask);

document.body.appendChild(mask_);

// Listen to the background process
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    console.log(request);

    var mask = shadow.getElementById(createId('mask'));
    var details = shadow.getElementById(createId('details'))
    var status = shadow.getElementById(createId('status'));

    switch (request.type) {
        case "downloading":
            cancelHighlight();
            switch (request.checksum_origin) {
                case ORIGIN_INTEGRITY_TAG:
                    details.innerHTML = MSG_DETAILS_INTEGRITY_TAG;
                    break;
                case ORIGIN_PAGE_TEXT:
                    details.innerHTML = MSG_DETAILS_PAGE_TEXT;
                    break;
            }
            status.innerHTML = MSG_DOWNLOADING;
            break
        case "computing":
            status.innerHTML = MSG_COMPUTING;
            break;
        case "verifying":
            if (request.valid) {
                switch (request.checksum_origin) {
                    case ORIGIN_INTEGRITY_TAG:
                        status.innerHTML = MSG_VERIFICATION_VALID_INTEGRITY_TAG;
                        break;
                    case ORIGIN_PAGE_TEXT:
                        highlightPattern(document.body, new RegExp(request.checksum_value_computed.join('|'), "gi"));
                        status.innerHTML = MSG_VERIFICATION_VALID_PAGE_TEXT;
                        break;
                }
            } else {
                switch (request.checksum_origin) {
                    case ORIGIN_INTEGRITY_TAG:
                        status.innerHTML = MSG_VERIFICATION_INVALID_INTEGRITY_TAG;
                        break;
                    case ORIGIN_PAGE_TEXT:
                        status.innerHTML = MSG_VERIFICATION_INVALID_PAGE_TEXT;
                        break;
                }

                shadow.getElementById('delete').onclick = makeRemoveDownloadedFile(request.id);
            }
            break;
        case "error":
            status.innerHTML = MSG_ERROR + request.message;
            console.log("Error: " + request.message)
            break;
        default:
            console.log("Unknown message: " + request)
            return;
    }
    mask.style.display = 'block';
});