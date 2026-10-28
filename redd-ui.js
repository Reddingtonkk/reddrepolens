(() => {
    const $ = s => document.querySelector(s);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

    const make = (tag, cls = "", txt) => {
        const el = document.createElement(tag);
        el.className = cls;
        if (txt !== undefined) el.textContent = txt;
        return el;
    };

    const bg = make("div", "redd-bg");
    bg.setAttribute("aria-hidden", "true");

    for (let i = 0; i < 3; i++) {
        bg.append(make("div", "redd-light"));
    }

    document.body.prepend(bg);

    if (!reduced) document.body.classList.add("redd-ready");

    if (!reduced && "IntersectionObserver" in window) {
        const observer = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                entry.target.classList.add("visible");
                observer.unobserve(entry.target);
            });
        }, { threshold: .05, rootMargin: "0px 0px 80px 0px" });

        const result = $("#resultado");

        const watch = () => {
            if (!result || result.classList.contains("escondido")) return;

            result.querySelectorAll(".repo-header, .stat, .card")
                .forEach(el => {
                    if (el.dataset.reddSeen) return;
                    el.dataset.reddSeen = "1";
                    el.classList.add("redd-reveal");
                    observer.observe(el);
                });
        };

        if (result) {
            new MutationObserver(watch).observe(result, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ["class"]
            });
            watch();
        }
    }

    let current = null;
    let previousFocus = null;

    function close() {
        if (!current) return;
        current.remove();
        current = null;

        if (previousFocus?.isConnected) previousFocus.focus();
    }

    function modal(title, desc, icon = "</>") {
        close();
        previousFocus = document.activeElement;

        const overlay = make("div", "redd-overlay");
        const card = make("section", "redd-modal");
        const x = make("button", "redd-close", "×");
        const symbol = make("div", "redd-modal-icon", icon);
        const heading = make("h2", "", title);
        const description = make("p", "", desc);

        x.type = "button";
        x.setAttribute("aria-label", "Fechar");
        x.onclick = close;

        heading.id = "redd-dialog-title";
        card.setAttribute("role", "dialog");
        card.setAttribute("aria-modal", "true");
        card.setAttribute("aria-labelledby", heading.id);

        card.append(x, symbol, heading, description);
        overlay.append(card);
        document.body.append(overlay);
        current = overlay;

        overlay.addEventListener("click", e => {
            if (e.target === overlay) close();
        });

        x.focus();
        return card;
    }

    document.addEventListener("keydown", e => {
        if (e.key === "Escape" && current) close();

        if (e.key === "Tab" && current) {
            const items = [...current.querySelectorAll(
                'a[href], button:not([disabled])'
            )];

            if (!items.length) return;

            const first = items[0];
            const last = items[items.length - 1];

            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        }
    });

    const button = (text, cls, fn) => {
        const el = make("button", cls, text);
        el.type = "button";
        el.addEventListener("click", fn);
        return el;
    };

    const link = (text, cls, url) => {
        const el = make("a", cls, text);
        el.href = url;
        return el;
    };

    const githubIcon = `<svg viewBox="0 0 24 24" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path d="M12 .8a11.2 11.2 0 0 0-3.54 21.82c.56.1.77-.24.77-.54v-2.1c-3.13.68-3.79-1.33-3.79-1.33-.51-1.3-1.25-1.25-1.65-1.02-.7.08-.69.08-.69 1.13.08 1.72 1.16 1.72 1.16 1 .1.65 2.62.5 3.26.38.1-.73.39-1.22.7-1.5-2.5-.28-5.13-1.25-5.13-5.54 0-1.23.44-2.23 1.16-3.02-.12-.28-.5-1.43.11-2.98 0 0 .95-.3 3.08 1.15a10.7 10.7 0 0 1 5.6 0c2.13-1.45 3.08-1.15 3.08-1.15.61 1.55.23 2.7.11 2.98.72.79 1.16 1.79 1.16 3.02 0 4.3-2.64 5.25-5.15 5.53.4.35.75 1.03.75 2.08v3.09c0 .3.21.65.78.54A11.2 11.2 0 0 0 12 .8z"/></svg>`;
    function login() {
        if (sessionStorage.getItem("redd-login-skip") === "1") return;

        const card = modal(
            "Bem-vindo ao ReddRepoLens",
            "Conecte sua conta GitHub para analisar repositórios, explorar tecnologias e preparar projetos.",
            "GH"
        );

        card.querySelector(".redd-modal-icon").innerHTML = githubIcon;
        card.append(
            link("Continuar com GitHub", "redd-primary", "/auth/github"),
            button("Explorar sem conectar", "redd-secondary", () => {
                sessionStorage.setItem("redd-login-skip", "1");
                close();
            })
        );

        card.querySelector(".redd-primary").focus();
    }

    function loginConcluido(user) {
        const card = modal(
            "Login realizado!",
            "Você entrou com sua conta do GitHub com sucesso.",
            ""
        );

        const icon = card.querySelector(".redd-modal-icon");
        const foto = make("img", "redd-welcome-avatar");
        foto.src = user.avatar;
        foto.alt = "Foto de " + user.login;
        icon.replaceChildren(foto);

        const nome = make("strong", "redd-welcome-name", "@" + user.login);
        const msg = make("p", "redd-welcome-msg",
            "Redd agradece por você usar ReddRepoLens : )");

        const continuar = button("Continuar", "redd-primary", close);

        card.append(nome, msg, continuar);
        continuar.focus();
    }

    async function checkLogin() {
        try {
            const res = await fetch("/api/me", {
                credentials: "same-origin",
                cache: "no-store"
            });

            if (!res.ok) {
                login();
                return;
            }

            const data = await res.json();
            const user = data.usuario;

            if (!data.autenticado || !user?.login) {
                login();
                return;
            }

            const url = new URL(window.location.href);

            if (url.searchParams.get("login") === "sucesso") {
                url.searchParams.delete("login");

                history.replaceState(
                    null,
                    "",
                    url.pathname + url.search + url.hash
                );

                loginConcluido(user);
            }
        } catch (err) {
            console.warn("Falha ao verificar login:", err);
        }
    }
    function getRepo() {
        const raw = $("#repo-url")?.value.trim();
        if (!raw) return null;

        let url;

        try {
            url = new URL(raw);
        } catch {
            return null;
        }

        if (url.protocol !== "https:" || url.hostname !== "github.com") {
            return null;
        }

        const parts = url.pathname.split("/").filter(Boolean);
        if (parts.length !== 2) return null;

        const owner = parts[0];
        const repo = parts[1].replace(/\.git$/i, "");

        if (!/^[a-zA-Z0-9-]{1,39}$/.test(owner)) return null;
        if (!/^[a-zA-Z0-9._-]{1,100}$/.test(repo)) return null;
        if (repo === "." || repo === "..") return null;

        return {
            owner,
            repo,
            url: `https://github.com/${owner}/${repo}`
        };
    }

    const editors = [
        ["Visual Studio Code", "Windows, macOS e Linux", "https://code.visualstudio.com/download"],
        ["VSCodium", "Gratuito e código aberto", "https://vscodium.com/"],
        ["IntelliJ IDEA", "IDE da JetBrains", "https://www.jetbrains.com/idea/download/"]
    ];

    function chooseEditor(repo) {
        const card = modal(
            "Escolha seu editor",
            "Não tem um editor instalado? Escolha uma opção para acessar o site oficial."
        );

        const list = make("div", "redd-editor-list");

        editors.forEach(([name, desc, url]) => {
            const row = make("div", "redd-editor-item");
            const info = make("div");
            const title = make("strong", "", name);
            const subtitle = make("small", "", desc);
            const install = link("Instalar ↗", "", url);

            install.target = "_blank";
            install.rel = "noopener noreferrer";

            info.append(title, subtitle);
            row.append(info, install);
            list.append(row);
        });

        card.append(list);

        if (repo) {
            const web = link(
                "Abrir no navegador",
                "redd-primary",
                `https://github.dev/${repo.owner}/${repo.repo}`
            );

            web.target = "_blank";
            web.rel = "noopener noreferrer";
            card.append(web);
        }

        card.append(
            button("Fechar", "redd-secondary", close)
        );
    }

    function openEditor(repo) {
        const card = modal(
            "Abrir projeto no VS Code",
            `Repositório: ${repo.owner}/${repo.repo}. O navegador vai solicitar a abertura do editor, caso esteja instalado.`
        );

        const vscode = link(
            "Abrir no VS Code",
            "redd-primary",
            "vscode://vscode.git/clone?url=" +
                encodeURIComponent(repo.url)
        );

        const alternatives = button(
            "Não tenho VS Code / Outros editores",
            "redd-secondary",
            () => chooseEditor(repo)
        );

        const web = link(
            "Abrir no editor web do GitHub",
            "redd-secondary",
            `https://github.dev/${repo.owner}/${repo.repo}`
        );

        web.target = "_blank";
        web.rel = "noopener noreferrer";

        card.append(vscode, alternatives, web);
        vscode.focus();
    }

    const search = $(".area-pesquisa");

    if (search) {
        const area = make("div", "redd-editor-area");
        const open = button("Clonar e abrir no editor", "redd-editor-btn", () => {
            const repo = getRepo();

            if (!repo) {
                const card = modal(
                    "Selecione um repositório",
                    "Cole a URL completa do GitHub antes de abrir o editor."
                );

                card.append(button("Entendi", "redd-primary", close));
                return;
            }

            openEditor(repo);
        });

        area.append(
            open,
            make("small", "", "VS Code, editor web e outras opções")
        );

        search.insertAdjacentElement("afterend", area);
    }

    checkLogin();
})();