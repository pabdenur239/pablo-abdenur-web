// Sitio institucional de Pablo Abdenur
// Menu movil y ano dinamico en el footer

document.addEventListener('DOMContentLoaded', function () {
    var navToggle = document.getElementById('navToggle');
    var mainNav = document.getElementById('mainNav');

                            if (navToggle && mainNav) {
                                  navToggle.addEventListener('click', function () {
                                          mainNav.classList.toggle('open');
                                  });

      var navLinks = mainNav.querySelectorAll('a');
                                  navLinks.forEach(function (link) {
                                          link.addEventListener('click', function () {
                                                    mainNav.classList.remove('open');
                                          });
                                  });
                            }

                            var yearSpan = document.getElementById('year');
    if (yearSpan) {
          yearSpan.textContent = new Date().getFullYear();
    }
});
