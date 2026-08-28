import "../home/navigation.js";
import "../home/gallery.js";
import { initHeaderAuth } from "../shared/auth-session.js";

initHeaderAuth();

const preloader = document.getElementById("app-preloader");
if (preloader) {
  const dismissPreloader = () => {
    preloader.classList.add("is-hidden");
    setTimeout(() => preloader.remove(), 400);
  };

  if (document.readyState === "complete") {
    dismissPreloader();
  } else {
    window.addEventListener("load", dismissPreloader, { once: true });
    setTimeout(dismissPreloader, 500);
  }
}
