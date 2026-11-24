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
let slides = document.querySelectorAll(".slide");
let current = 0;

function nextSlide() {
    slides[current].classList.remove("active");
    current = (current + 1) % slides.length;
    slides[current].classList.add("active");
}

setInterval(nextSlide, 4000);