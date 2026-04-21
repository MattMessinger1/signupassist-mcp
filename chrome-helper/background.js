chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    signupassistEnabled: true,
    signupassistAssistMode: false,
    signupassistHelperCode: "",
  });
});
