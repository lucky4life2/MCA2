// Auto update year in footer
document.getElementById("year").textContent = new Date().getFullYear();

// Join button interaction
const joinBtn = document.getElementById("joinBtn");

joinBtn.addEventListener("click", () => {
    joinBtn.textContent = "You're In!";
    joinBtn.style.background = "#00c853";
    joinBtn.style.color = "white";
    
    setTimeout(() => {
        joinBtn.textContent = "Join Now";
        joinBtn.style.background = "#00e676";
        joinBtn.style.color = "black";
    }, 2000);
});
// server status
const serverIP = "172.240.79.112:2023";
  const apiURL = `https://api.mcstatus.io/v2/status/java/${serverIP}`;

  async function checkStatus() {
    const statusEl = document.getElementById("status");
    const card = document.getElementById("status-card");

    try {
      const res = await fetch(apiURL, { cache: "no-store" });
      const data = await res.json();

      if (data && data.online === true) {
        statusEl.innerHTML = `
          🟢 Online<br>
          ${data.players?.online ?? 0} / ${data.players?.max ?? "?"} players<br>
          Version: ${data.version?.name_clean ?? "Unknown"}
        `;
        card.classList.add("online");
      } else {
        statusEl.innerHTML = `🔴 Offline`;
        card.classList.remove("online");
        card.classList.add("offline")
      }
    } catch (err) {
      statusEl.innerText = "Status unavailable.";
      card.classList.remove("online");
      card.classList.add("offline");
    }
  }

  checkStatus();
  setInterval(checkStatus, 5000);

let slides = document.querySelectorAll(".slide");
let current = 0;

function nextSlide() {
    slides[current].classList.remove("active");
    current = (current + 1) % slides.length;
    slides[current].classList.add("active");
}

setInterval(nextSlide, 4000);