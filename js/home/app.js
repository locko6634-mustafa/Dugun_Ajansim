import "./navigation.js";
import "./faq.js";
import "./gallery.js";
import "./shoots.js";
import "./services.js";
import "./venues.js";
import "./motion.js";
import { initHeaderAuth } from "../shared/auth-session.js";
import { initCurrentYear } from "../shared/site-content.js";

initHeaderAuth();
initCurrentYear();

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
