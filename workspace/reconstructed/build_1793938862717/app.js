document.getElementById("action-btn").addEventListener("click", () => {
  const box = document.getElementById("console-box");
  box.textContent = "[YUNAY Runtime] Diagnostics passed at " + new Date().toLocaleTimeString();
});