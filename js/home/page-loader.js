const pageLoader = document.querySelector(".page-loader");
let loaderHidden = false;

function hidePageLoader() {
  if (!pageLoader || loaderHidden) return;
  loaderHidden = true;
  pageLoader.classList.add("is-hidden");
  pageLoader.setAttribute("aria-hidden", "true");

  const removeLoader = () => {
    document.body.classList.remove("page-loading");
    pageLoader.remove();
  };

  pageLoader.addEventListener("transitionend", removeLoader, { once: true });
  window.setTimeout(removeLoader, 800);
}

if (document.readyState === "complete") {
  requestAnimationFrame(hidePageLoader);
} else {
  window.addEventListener("load", hidePageLoader, { once: true });
}

window.setTimeout(hidePageLoader, 8000);
