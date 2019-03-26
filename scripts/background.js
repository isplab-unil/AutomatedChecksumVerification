CHECKSUM_TYPE_MD5 = 'md5';
CHECKSUM_TYPE_SHA1 = 'sha1';
CHECKSUM_TYPE_SHA256 = 'sha256';

function send_error(tab, message) {
  chrome.tabs.sendMessage(tab, {
    type: "error",
    message: message
  });
}

// Keep track of the download requests
var downloads = {};

// Intercept the download requests emitted by tabs
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  var tab = parseInt(sender.tab.id);

  switch(request.type) {
    case "download":
      chrome.downloads.download({url: request.download}, function(downloadId) {
        downloads[downloadId] = {
          request: request,
          download: request.download,
          checksum: request.checksum,
          tab: tab
        }
      });
      chrome.tabs.sendMessage(tab, {
        type: "downloading",
        checksum_origin: request.checksum.origin
      });
      break;
    case "remove":
      chrome.downloads.removeFile(request.id);
      break;
    default:
      send_error(tab, "Unknown request type: " + request.type);
      break;
  }
});

chrome.downloads.onChanged.addListener(function(download) {

  if(!(download.id in downloads)) { // the download was not registered (i.e., wasn't triggered from a download link instrumented by the ext)
    return;
  }

  var tab = downloads[download.id].tab;
  // Register the local filename of the download
  if (download.filename) {
    downloads[download.id].filename = "file://" + download.filename.current;
  }

  // TODO: Send a cancellation message to the tab that created the download request

  // Compute the checksum of the downloaded file
  if (download.state && download.state.current == 'complete') {
    var xhr = new XMLHttpRequest();
    xhr.responseType = 'arraybuffer';
    
    // Send the a verification message to the tab that created the download request
    xhr.addEventListener("load", function() {

      chrome.tabs.sendMessage(tab, {type: "computing"});

      var checksum = downloads[download.id].checksum;
      var checksum_value_computed;
      var checksum_types = checksum.type;
      var checksum_value_actual = new Set(checksum.value);
      var checksum_value_computed = new Set();

      for(var checksum_type of checksum_types) {
        switch(checksum_type) {
          case CHECKSUM_TYPE_MD5:
            checksum_value_computed.add(md5.hex(xhr.response));
            break;
          case CHECKSUM_TYPE_SHA1:
            checksum_value_computed.add(asmCrypto.SHA1.hex(xhr.response));
            break;
          case CHECKSUM_TYPE_SHA256:
            checksum_value_computed.add(asmCrypto.SHA256.hex(xhr.response));
            break;
          default:
            send_error(tab, "An error occured while computing the checksum: Unknown checksum type '" + checksum_type + "'");
            continue
        }
      }

      chrome.tabs.sendMessage(tab, {
        type: "verifying",
        valid: new Set([...checksum_value_computed].filter(x => checksum_value_actual.has(x))).size > 0,
        checksum_value_actual: [...checksum_value_actual],
        checksum_value_computed: [...checksum_value_computed],
        checksum_origin: checksum.origin,
        id: download.id,
      });
      delete downloads[download.id];
    });

    // Send an error message to the tab that created the download request
    xhr.addEventListener("error", function() {
      send_error(tab, "An error occured while accessing the downloaded file");
      delete downloads[download.id];
    });

    // Send the request to read the local (downloaded file)
    xhr.open("GET", downloads[download.id].filename, true);
    xhr.send();
  }
  
});
