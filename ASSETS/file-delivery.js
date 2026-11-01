(() => {
  'use strict';
  window.CSTRFiles = {
    async deliver(blob, filename) {
      if (window.CSTRMobile?.native) {
        await window.CSTRMobile.saveFile(blob,filename);
        return {filename,delivery:'native-share-completed'};
      }
      const url = URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.href = url; anchor.download = filename;
      document.body.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url),60000);
      return {filename,delivery:'browser-download-requested'};
    }
  };
})();
