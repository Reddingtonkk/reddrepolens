console.log("ReddRepoLens carregado!");


// ======================================================
// CONFIGURAÇÃO
// ======================================================

const BACKEND = window.location.origin;

const botao = document.getElementById("analyze-btn");
const repoInput = document.getElementById("repo-url");

// Impede duas análises ao mesmo tempo (ex.: clique + Enter)
let analiseEmAndamento = false;


// ======================================================
// FETCH PARA O BACKEND
// ======================================================

async function backendFetch(caminho, opcoes = {}) {

    return fetch(`${BACKEND}${caminho}`, {
        ...opcoes,

        credentials: "include",

        headers: {
            ...(opcoes.headers || {})
        }
    });
}


// ======================================================
// LOGIN / USUÁRIO GITHUB
// ======================================================

async function carregarUsuario() {

    const login =
        document.getElementById("github-login");

    const userArea =
        document.getElementById("github-user");

    const username =
        document.getElementById("github-username");

    const avatar =
        document.getElementById("github-avatar");


    try {

        const resposta =
            await backendFetch("/api/me");


        if (!resposta.ok) {

            login?.classList.remove("escondido");
            userArea?.classList.add("escondido");

            return false;
        }


        const dados =
            await resposta.json();


        if (!dados.autenticado) {

            login?.classList.remove("escondido");
            userArea?.classList.add("escondido");

            return false;
        }


        login?.classList.add("escondido");
        userArea?.classList.remove("escondido");


        if (username) {

            username.textContent =
                `@${dados.usuario.login}`;
        }


        if (avatar) {

            avatar.src =
                dados.usuario.avatar;

            avatar.alt =
                `Avatar de ${dados.usuario.login}`;
        }


        await carregarRateLimit();


        return true;

    } catch (erro) {

        console.error(
            "Erro verificando login:",
            erro
        );


        login?.classList.remove("escondido");
        userArea?.classList.add("escondido");


        return false;
    }
}


// ======================================================
// RATE LIMIT
// ======================================================

async function carregarRateLimit() {

    const elemento =
        document.getElementById("github-rate");


    if (!elemento) {
        return;
    }


    try {

        const resposta =
            await backendFetch(
                "/api/rate-limit"
            );


        if (!resposta.ok) {

            elemento.textContent =
                "API indisponível";

            return;
        }


        const dados =
            await resposta.json();


        elemento.textContent =
            `API ${formatarNumero(dados.restantes)} / ` +
            `${formatarNumero(dados.limite)}`;


    } catch {

        elemento.textContent =
            "API indisponível";
    }
}


// ======================================================
// LOGOUT
// ======================================================

const logout =
    document.getElementById("github-logout");


if (logout) {

    logout.addEventListener(
        "click",
        async () => {

            try {

                await backendFetch(
                    "/auth/logout",
                    {
                        method: "POST"
                    }
                );


                window.location.href =
                    window.location.origin +
                    window.location.pathname;


            } catch (erro) {

                console.error(
                    "Erro logout:",
                    erro
                );
            }
        }
    );
}


// ======================================================
// API DO GITHUB PELO BACKEND
// ======================================================

async function githubFetch(
    dono,
    repo,
    caminho = ""
) {

    const ownerSeguro =
        encodeURIComponent(dono);

    const repoSeguro =
        encodeURIComponent(repo);


    let url =
        `/api/github/repos/` +
        `${ownerSeguro}/` +
        `${repoSeguro}`;


    if (caminho) {

        url += caminho.startsWith("/")
            ? caminho
            : `/${caminho}`;
    }


    const resposta =
        await backendFetch(url);


    if (resposta.status === 401) {

        throw new Error(
            "Faça login com GitHub antes de analisar."
        );
    }


    if (resposta.status === 404) {

        throw new Error(
            "Repositório não encontrado."
        );
    }


    if (resposta.status === 403) {

        throw new Error(
            "O GitHub recusou a requisição ou o limite da API foi atingido."
        );
    }


    if (resposta.status === 429) {

        throw new Error(
            "Muitas requisições. Aguarde alguns minutos e tente novamente."
        );
    }


    if (resposta.status === 504) {

        throw new Error(
            "O GitHub demorou demais para responder. Tente novamente."
        );
    }


    if (!resposta.ok) {

        throw new Error(
            `GitHub respondeu com erro ${resposta.status}.`
        );
    }


    return resposta;
}


// ======================================================
// LEITOR DE ARQUIVO PELO BACKEND
// ======================================================

async function lerArquivo(
    dono,
    repo,
    branch,
    caminho
) {

    const parametros =
        new URLSearchParams({
            owner: dono,
            repo,
            ref: branch,
            path: caminho
        });


    try {

        const resposta =
            await backendFetch(
                `/api/file?${parametros.toString()}`
            );


        if (!resposta.ok) {

            console.warn(
                "Não foi possível ler:",
                caminho
            );

            return null;
        }


        return await resposta.text();


    } catch (erro) {

        console.warn(
            "Erro lendo arquivo:",
            caminho,
            erro
        );


        return null;
    }
}


// ======================================================
// JSON
// ======================================================

async function lerJsonRepositorio(
    dono,
    repo,
    branch,
    caminho
) {

    const texto =
        await lerArquivo(
            dono,
            repo,
            branch,
            caminho
        );


    if (!texto) {
        return null;
    }


    try {

        return JSON.parse(texto);

    } catch {

        return null;
    }
}


// ======================================================
// REQUIREMENTS.TXT
// ======================================================

function analisarDependencia(dependency) {

    let linha =
        dependency
            .trim()
            .replace(/\s+#.*$/, "");


    if (!linha) {
        return null;
    }


    const operadores = [
        "===",
        ">=",
        "<=",
        "==",
        "~=",
        "!=",
        ">",
        "<"
    ];


    for (const operador of operadores) {

        if (linha.includes(operador)) {

            const indice =
                linha.indexOf(operador);


            const nome =
                linha
                    .slice(0, indice)
                    .trim();


            const versao =
                linha
                    .slice(
                        indice +
                        operador.length
                    )
                    .trim();


            if (!nome) {
                return null;
            }


            return {
                nome,
                versao:
                    versao ||
                    "Não especificada",
                operador
            };
        }
    }


    // extras tipo requests[socks]

    const nome =
        linha.split(";")[0].trim();


    return {
        nome,
        versao:
            "Não especificada",
        operador: null
    };
}


async function analisarRequirements(
    dono,
    repo,
    branch,
    caminho
) {

    const texto =
        await lerArquivo(
            dono,
            repo,
            branch,
            caminho
        );


    if (!texto) {
        return [];
    }


    const dependencias = [];


    for (
        const linhaOriginal
        of texto.split(/\r?\n/)
    ) {

        const linha =
            linhaOriginal.trim();


        if (
            !linha ||
            linha.startsWith("#") ||
            linha.startsWith("-r") ||
            linha.startsWith("--") ||
            linha.startsWith("git+") ||
            linha.startsWith("http://") ||
            linha.startsWith("https://")
        ) {

            continue;
        }


        const dependencia =
            analisarDependencia(linha);


        if (dependencia) {

            dependencias.push(
                dependencia
            );
        }
    }


    return dependencias;
}


// ======================================================
// PACKAGE.JSON
// ======================================================

async function analisarPackageJson(
    dono,
    repo,
    branch,
    caminho
) {

    const packageJson =
        await lerJsonRepositorio(
            dono,
            repo,
            branch,
            caminho
        );


    if (!packageJson) {
        return null;
    }


    return {

        caminho,

        nome:
            packageJson.name ||
            null,

        versao:
            packageJson.version ||
            null,

        producao:
            packageJson.dependencies ||
            {},

        desenvolvimento:
            packageJson.devDependencies ||
            {},

        peerDependencies:
            packageJson.peerDependencies ||
            {},

        optionalDependencies:
            packageJson.optionalDependencies ||
            {},

        scripts:
            packageJson.scripts ||
            {},

        engines:
            packageJson.engines ||
            {},

        workspaces:
            packageJson.workspaces ||
            null,

        packageManager:
            packageJson.packageManager ||
            null,

        type:
            packageJson.type ||
            null
    };
}


// ======================================================
// JUNTA DEPENDÊNCIAS NODE
// ======================================================

function juntarDependenciasNode(packages) {

    const producao = {};
    const desenvolvimento = {};


    for (const pacote of packages) {

        Object.assign(
            producao,
            pacote.producao,
            pacote.peerDependencies,
            pacote.optionalDependencies
        );


        Object.assign(
            desenvolvimento,
            pacote.desenvolvimento
        );
    }


    return {
        producao,
        desenvolvimento
    };
}


// ======================================================
// LINGUAGENS
// ======================================================

async function buscarLinguagens(
    dono,
    repo
) {

    const resposta =
        await githubFetch(
            dono,
            repo,
            "/languages"
        );


    return await resposta.json();
}


// ======================================================
// ÚLTIMO COMMIT
// ======================================================

async function buscarUltimoCommit(
    dono,
    repo
) {

    try {

        const resposta =
            await githubFetch(
                dono,
                repo,
                "/commits?per_page=1"
            );


        const commits =
            await resposta.json();


        if (
            !Array.isArray(commits) ||
            !commits.length
        ) {

            return null;
        }


        const ultimo =
            commits[0];


        return {

            mensagem:
                ultimo.commit?.message ||
                "Sem mensagem",

            autor:
                ultimo.commit?.author?.name ||
                ultimo.author?.login ||
                "Desconhecido",

            data:
                ultimo.commit?.author?.date ||
                ultimo.commit?.committer?.date ||
                null
        };


    } catch (erro) {

        console.warn(
            "Não foi possível buscar commit:",
            erro
        );


        return null;
    }
}


// ======================================================
// ÁRVORE
// ======================================================

async function buscarArvore(
    dono,
    repo,
    branch
) {

    const resposta =
        await githubFetch(
            dono,
            repo,
            `/git/trees/${encodeURIComponent(branch)}?recursive=1`
        );


    const dados =
        await resposta.json();


    return {

        arquivos:
            dados.tree ||
            [],

        truncada:
            dados.truncated === true
    };
}


// ======================================================
// CONFIGS RECONHECIDAS
// ======================================================

const configsReconhecidas =
    new Set([

        "package.json",
        "package-lock.json",
        "yarn.lock",
        "pnpm-lock.yaml",

        "tsconfig.json",
        "jsconfig.json",

        "angular.json",
        "nest-cli.json",

        "deno.json",
        "deno.jsonc",

        "vite.config.js",
        "vite.config.ts",
        "vite.config.mjs",

        "webpack.config.js",
        "webpack.config.ts",

        "next.config.js",
        "next.config.mjs",
        "next.config.ts",

        "nuxt.config.js",
        "nuxt.config.ts",

        "vercel.json",
        "firebase.json",

        "composer.json",
        "composer.lock",

        "requirements.txt",
        "pyproject.toml",
        "pipfile",
        "pipfile.lock",
        "poetry.lock",
        "setup.py",
        "setup.cfg",

        "cargo.toml",
        "cargo.lock",

        "go.mod",
        "go.sum",

        "pom.xml",
        "build.gradle",
        "build.gradle.kts",

        "dockerfile",
        "docker-compose.yml",
        "docker-compose.yaml",

        ".eslintrc",
        ".eslintrc.json",
        ".eslintrc.js",

        "eslint.config.js",
        "eslint.config.mjs",

        ".prettierrc",
        ".prettierrc.json",

        "tailwind.config.js",
        "tailwind.config.ts",

        "postcss.config.js",

        "babel.config.js",

        "jest.config.js",
        "jest.config.ts",

        "vitest.config.js",
        "vitest.config.ts"
    ]);


function detectarConfigs(arquivos) {

    return arquivos.filter(
        arquivo => {

            const nome =
                arquivo.nome
                    .toLowerCase();


            const caminho =
                arquivo.caminho
                    .toLowerCase();


            return (

                configsReconhecidas.has(nome) ||

                caminho.startsWith(
                    ".github/workflows/"
                ) ||

                caminho.includes(
                    "/.github/workflows/"
                )
            );
        }
    );
}


// ======================================================
// DETECTAR TECNOLOGIAS
// ======================================================

function detectarTecnologias(resultado) {

    const stack =
        new Set(resultado.stack);

    const ferramentas =
        new Set(resultado.ferramentas);

    const infraestrutura =
        new Set(resultado.infraestrutura);


    const nomes =
        resultado.arquivos.map(
            arquivo =>
                arquivo.nome.toLowerCase()
        );


    const caminhos =
        resultado.arquivos.map(
            arquivo =>
                arquivo.caminho.toLowerCase()
        );


    const node = {

        ...resultado
            .dependenciasNode
            .producao,

        ...resultado
            .dependenciasNode
            .desenvolvimento
    };


    const nodeNames =
        Object.keys(node)
            .map(nome =>
                nome.toLowerCase()
            );


    const pythonNames =
        resultado.dependencias
            .map(dep =>
                dep.nome.toLowerCase()
            );


    const linguagens =
        Object.keys(
            resultado.linguagens
        );


    // ==================================================
    // LINGUAGENS
    // ==================================================

    for (const linguagem of linguagens) {

        if (
            linguagem.toLowerCase() !==
            "dockerfile"
        ) {

            stack.add(
                linguagem
            );
        }
    }


    // ==================================================
    // NODE
    // ==================================================

    if (nomes.includes("package.json")) {

        stack.add("Node.js");
    }


    if (
        nomes.includes("tsconfig.json") ||
        nodeNames.includes("typescript")
    ) {

        stack.add("TypeScript");
    }


    // ==================================================
    // PYTHON
    // ==================================================

    if (
        nomes.includes("requirements.txt") ||
        nomes.includes("pyproject.toml") ||
        nomes.includes("pipfile") ||
        nomes.includes("setup.py")
    ) {

        stack.add("Python");
    }


    // ==================================================
    // OUTRAS LINGUAGENS
    // ==================================================

    if (nomes.includes("cargo.toml")) {

        stack.add("Rust");
        ferramentas.add("Cargo");
    }


    if (nomes.includes("go.mod")) {

        stack.add("Go");
    }


    if (
        nomes.includes("pom.xml") ||
        nomes.includes("build.gradle") ||
        nomes.includes("build.gradle.kts")
    ) {

        stack.add("Java");
    }


    if (nomes.includes("composer.json")) {

        stack.add("PHP");
        ferramentas.add("Composer");
    }


    if (
        nomes.includes("deno.json") ||
        nomes.includes("deno.jsonc")
    ) {

        stack.add("Deno");
    }


    // ==================================================
    // FRAMEWORKS JS
    // ==================================================

    if (nodeNames.includes("next")) {

        stack.add("Next.js");
    }


    if (nodeNames.includes("react")) {

        stack.add("React");
    }


    if (nodeNames.includes("react-dom")) {

        stack.add("React DOM");
    }


    if (nodeNames.includes("vue")) {

        stack.add("Vue");
    }


    if (
        nodeNames.includes("@angular/core") ||
        nomes.includes("angular.json")
    ) {

        stack.add("Angular");
    }


    if (
        nodeNames.includes("@nestjs/core") ||
        nomes.includes("nest-cli.json")
    ) {

        stack.add("NestJS");
    }


    if (nodeNames.includes("express")) {

        stack.add("Express");
    }


    if (nodeNames.includes("fastify")) {

        stack.add("Fastify");
    }


    if (nodeNames.includes("electron")) {

        stack.add("Electron");
    }


    if (nodeNames.includes("svelte")) {

        stack.add("Svelte");
    }


    if (nodeNames.includes("nuxt")) {

        stack.add("Nuxt");
    }


    // ==================================================
    // BANCO / ORM
    // ==================================================

    if (
        nodeNames.includes("prisma") ||
        nodeNames.includes("@prisma/client")
    ) {

        stack.add("Prisma");
    }


    if (nodeNames.includes("mongoose")) {

        stack.add("MongoDB");
    }


    if (nodeNames.includes("mongodb")) {

        stack.add("MongoDB");
    }


    if (nodeNames.includes("sequelize")) {

        stack.add("Sequelize");
    }


    if (nodeNames.includes("typeorm")) {

        stack.add("TypeORM");
    }


    if (nodeNames.includes("pg")) {

        stack.add("PostgreSQL");
    }


    if (
        nodeNames.includes("mysql") ||
        nodeNames.includes("mysql2")
    ) {

        stack.add("MySQL");
    }


    if (
        nodeNames.includes("better-sqlite3") ||
        nodeNames.includes("sqlite3")
    ) {

        stack.add("SQLite");
    }


    // ==================================================
    // PYTHON
    // ==================================================

    if (pythonNames.includes("django")) {

        stack.add("Django");
    }


    if (pythonNames.includes("flask")) {

        stack.add("Flask");
    }


    if (pythonNames.includes("fastapi")) {

        stack.add("FastAPI");
    }


    if (pythonNames.includes("sqlalchemy")) {

        stack.add("SQLAlchemy");
    }


    if (pythonNames.includes("discord.py")) {

        stack.add("discord.py");
    }


    if (
        pythonNames.includes("pymongo")
    ) {

        stack.add("MongoDB");
    }


    if (
        pythonNames.includes("pymysql") ||
        pythonNames.includes(
            "mysql-connector-python"
        )
    ) {

        stack.add("MySQL");
    }


    if (
        pythonNames.some(
            nome =>
                nome.includes("psycopg")
        )
    ) {

        stack.add("PostgreSQL");
    }


    // ==================================================
    // FERRAMENTAS
    // ==================================================

    const ferramentasNode = {

        vite: "Vite",

        webpack: "Webpack",

        eslint: "ESLint",

        prettier: "Prettier",

        axios: "Axios",

        jest: "Jest",

        vitest: "Vitest",

        mocha: "Mocha",

        nodemon: "Nodemon",

        husky: "Husky",

        "lint-staged":
            "lint-staged",

        tailwindcss:
            "Tailwind CSS",

        sass:
            "Sass",

        dotenv:
            "dotenv",

        pm2:
            "PM2",

        playwright:
            "Playwright",

        cypress:
            "Cypress"
    };


    for (
        const [dependencia, nome]
        of Object.entries(
            ferramentasNode
        )
    ) {

        if (
            nodeNames.includes(
                dependencia
            )
        ) {

            ferramentas.add(nome);
        }
    }


    if (pythonNames.includes("pytest")) {

        ferramentas.add("Pytest");

        resultado.testes.detectados =
            true;
    }


    if (
        nodeNames.includes("jest") ||
        nodeNames.includes("vitest") ||
        nodeNames.includes("mocha") ||
        nodeNames.includes("playwright") ||
        nodeNames.includes("cypress")
    ) {

        resultado.testes.detectados =
            true;
    }


    // ==================================================
    // INFRA
    // ==================================================

    if (
        nomes.includes("dockerfile") ||
        caminhos.some(
            caminho =>
                caminho.endsWith(
                    "/dockerfile"
                )
        )
    ) {

        infraestrutura.add("Docker");

        resultado.container.docker =
            true;
    }


    if (
        nomes.includes(
            "docker-compose.yml"
        ) ||
        nomes.includes(
            "docker-compose.yaml"
        )
    ) {

        infraestrutura.add(
            "Docker Compose"
        );
    }


    if (
        caminhos.some(
            caminho =>
                caminho.startsWith(
                    ".github/workflows/"
                ) ||
                caminho.includes(
                    "/.github/workflows/"
                )
        )
    ) {

        infraestrutura.add(
            "GitHub Actions"
        );

        resultado.cicd.githubActions =
            true;
    }


    if (nomes.includes("vercel.json")) {

        infraestrutura.add("Vercel");
    }


    if (nomes.includes("firebase.json")) {

        infraestrutura.add("Firebase");
    }


    if (
        caminhos.some(
            caminho =>
                caminho.includes("/k8s/") ||
                caminho.startsWith("k8s/") ||
                caminho.includes(
                    "kubernetes"
                )
        )
    ) {

        infraestrutura.add(
            "Kubernetes"
        );
    }


    if (
        caminhos.some(
            caminho =>
                caminho.includes(
                    "serverless.yml"
                ) ||
                caminho.includes(
                    "serverless.yaml"
                )
        )
    ) {

        infraestrutura.add(
            "Serverless"
        );
    }


    // ==================================================
    // DOCUMENTAÇÃO
    // ==================================================

    if (
        caminhos.some(
            caminho =>
                caminho
                    .split("/")
                    .some(
                        parte =>
                            parte === "docs" ||
                            parte ===
                                "documentation"
                    )
        )
    ) {

        resultado
            .documentacao
            .pastaDocs =
            true;
    }


    // ==================================================
    // TESTES POR PASTA
    // ==================================================

    if (
        caminhos.some(
            caminho =>
                caminho
                    .split("/")
                    .some(
                        parte =>
                            parte === "test" ||
                            parte === "tests" ||
                            parte === "__tests__"
                    )
        )
    ) {

        resultado.testes.detectados =
            true;
    }


    resultado.stack =
        [...stack].sort();


    resultado.ferramentas =
        [...ferramentas].sort();


    resultado.infraestrutura =
        [...infraestrutura].sort();
}


// ======================================================
// UI
// ======================================================

function criarTag(texto) {

    const tag =
        document.createElement("span");


    tag.className =
        "tag";


    tag.textContent =
        texto;


    return tag;
}


function preencherTags(
    id,
    itens,
    textoVazio
) {

    const elemento =
        document.getElementById(id);


    if (!elemento) {
        return;
    }


    elemento.replaceChildren();


    if (!itens.length) {

        elemento.appendChild(
            criarTag(textoVazio)
        );

        return;
    }


    for (const item of itens) {

        elemento.appendChild(
            criarTag(item)
        );
    }
}


function formatarNumero(numero) {

    return new Intl.NumberFormat(
        "pt-BR"
    ).format(
        numero || 0
    );
}


function formatarData(data) {

    if (!data) {

        return "Desconhecida";
    }


    const date =
        new Date(data);


    if (
        Number.isNaN(
            date.getTime()
        )
    ) {

        return "Desconhecida";
    }


    return date.toLocaleDateString(
        "pt-BR"
    );
}


// ======================================================
// DEPENDÊNCIAS NA TELA
// ======================================================

function preencherDependencias(
    elementoId,
    contadorId,
    dependencias,
    tipo
) {

    const elemento =
        document.getElementById(
            elementoId
        );


    const contador =
        document.getElementById(
            contadorId
        );


    if (!elemento) {
        return;
    }


    elemento.replaceChildren();

    elemento.classList.remove(
        "expandido"
    );


    let lista = [];


    if (tipo === "node") {

        lista =
            Object.entries(
                dependencias
            ).map(
                ([nome, versao]) => ({
                    nome,
                    versao
                })
            );
    }


    if (tipo === "python") {

        lista =
            dependencias.map(
                dep => ({

                    nome:
                        dep.nome,

                    versao:
                        dep.operador
                            ? `${dep.operador}${dep.versao}`
                            : dep.versao
                })
            );
    }


    const mapa =
        new Map();


    for (const dep of lista) {

        const chave =
            dep.nome.toLowerCase();


        if (!mapa.has(chave)) {

            mapa.set(
                chave,
                dep
            );
        }
    }


    lista =
        [...mapa.values()];


    lista.sort(
        (a, b) =>
            a.nome.localeCompare(
                b.nome
            )
    );


    if (contador) {

        contador.textContent =
            lista.length;
    }


    if (!lista.length) {

        const vazio =
            document.createElement(
                "span"
            );


        vazio.className =
            "dependency-empty";


        vazio.textContent =
            "Nenhuma dependência detectada.";


        elemento.appendChild(
            vazio
        );


        return;
    }


    for (const dep of lista) {

        let texto =
            dep.nome;


        if (
            dep.versao &&
            dep.versao !==
                "Não especificada"
        ) {

            texto +=
                ` ${dep.versao}`;
        }


        elemento.appendChild(
            criarTag(texto)
        );
    }
}


// ======================================================
// MOSTRAR TODAS AS DEPENDÊNCIAS
// ======================================================

function configurarBotaoDependencias() {

    const card =
        document.querySelector(
            ".dependencies-card"
        );


    if (!card) {
        return;
    }


    const areas = [

        document.getElementById(
            "production-dependencies"
        ),

        document.getElementById(
            "development-dependencies"
        ),

        document.getElementById(
            "python-dependencies"
        )

    ].filter(Boolean);


    const antigo =
        card.querySelector(
            ".dependencies-actions"
        );


    if (antigo) {

        antigo.remove();
    }


    const precisaBotao =
        areas.some(
            area =>
                area.querySelectorAll(
                    ".tag"
                ).length > 12
        );


    if (!precisaBotao) {

        for (const area of areas) {

            area.classList.add(
                "expandido"
            );
        }


        return;
    }


    const actions =
        document.createElement("div");


    actions.className =
        "dependencies-actions";


    const button =
        document.createElement(
            "button"
        );


    button.type =
        "button";


    button.className =
        "dependencies-button";


    button.textContent =
        "Mostrar todas";


    let aberto =
        false;


    button.addEventListener(
        "click",
        () => {

            aberto =
                !aberto;


            for (const area of areas) {

                area.classList.toggle(
                    "expandido",
                    aberto
                );
            }


            button.textContent =
                aberto
                    ? "Mostrar menos"
                    : "Mostrar todas";
        }
    );


    actions.appendChild(button);

    card.appendChild(actions);
}


// ======================================================
// TRADUÇÃO SIMPLES DO COMMIT
// ======================================================

function traduzirCommit(mensagemOriginal) {

    let mensagem =
        mensagemOriginal
            .split("\n")[0]
            .replace(
                /\s*\(#\d+\)\s*$/,
                ""
            )
            .trim();


    const traducoesInicio = [

        [/^feat(\(.+?\))?:\s*/i,
            "Adicionou: "],

        [/^fix(\(.+?\))?:\s*/i,
            "Corrigiu: "],

        [/^refactor(\(.+?\))?:\s*/i,
            "Refatorou: "],

        [/^docs(\(.+?\))?:\s*/i,
            "Documentação: "],

        [/^test(\(.+?\))?:\s*/i,
            "Testes: "],

        [/^style(\(.+?\))?:\s*/i,
            "Estilo: "],

        [/^perf(\(.+?\))?:\s*/i,
            "Melhorou desempenho: "],

        [/^build(\(.+?\))?:\s*/i,
            "Build: "],

        [/^chore(\(.+?\))?:\s*/i,
            "Manutenção: "],

        [/^ci(\(.+?\))?:\s*/i,
            "CI/CD: "],

        [/^update:\s*/i,
            "Atualizou: "],

        [/^update\s+/i,
            "Atualizou "],

        [/^add:\s*/i,
            "Adicionou: "],

        [/^add\s+/i,
            "Adicionou "],

        [/^remove:\s*/i,
            "Removeu: "],

        [/^remove\s+/i,
            "Removeu "],

        [/^restore:\s*/i,
            "Restaurou: "],

        [/^create:\s*/i,
            "Criou: "],

        [/^change:\s*/i,
            "Alterou: "],

        [/^merge:\s*/i,
            "Mesclou: "]
    ];


    for (
        const [padrao, traducao]
        of traducoesInicio
    ) {

        if (padrao.test(mensagem)) {

            mensagem =
                mensagem.replace(
                    padrao,
                    traducao
                );

            break;
        }
    }


    // Algumas palavras comuns para deixar
    // commits simples mais legíveis em português.

    const palavras = [

        [/\bdependencies\b/gi,
            "dependências"],

        [/\bdependency\b/gi,
            "dependência"],

        [/\bdocumentation\b/gi,
            "documentação"],

        [/\breadme\b/gi,
            "README"],

        [/\btests\b/gi,
            "testes"],

        [/\btest\b/gi,
            "teste"],

        [/\bconfig\b/gi,
            "configuração"],

        [/\bconfiguration\b/gi,
            "configuração"],

        [/\berror\b/gi,
            "erro"],

        [/\bbug\b/gi,
            "bug"],

        [/\bversion\b/gi,
            "versão"],

        [/\bsupport\b/gi,
            "suporte"],

        [/\bsecurity\b/gi,
            "segurança"],

        [/\bperformance\b/gi,
            "desempenho"]
    ];


    for (
        const [padrao, traducao]
        of palavras
    ) {

        mensagem =
            mensagem.replace(
                padrao,
                traducao
            );
    }


    if (mensagem.length > 180) {

        mensagem =
            mensagem.slice(
                0,
                180
            ) + "...";
    }


    return mensagem;
}


// ======================================================
// MOSTRAR RESULTADO
// ======================================================

function mostrarResultado(resultado) {

    const area =
        document.getElementById(
            "resultado"
        );


    if (!area) {
        return;
    }


    document.getElementById(
        "repo-name"
    ).textContent =
        resultado.repositorio.nome;


    document.getElementById(
        "repo-owner"
    ).textContent =
        resultado.repositorio.nomeCompleto;


    document.getElementById(
        "repo-description"
    ).textContent =
        resultado.repositorio.descricao ||
        "Este repositório não possui descrição.";


    // ==================================================
    // STATS
    // ==================================================

    document.getElementById(
        "repo-stars"
    ).textContent =
        formatarNumero(
            resultado.repositorio.estrelas
        );


    document.getElementById(
        "repo-forks"
    ).textContent =
        formatarNumero(
            resultado.repositorio.forks
        );


    document.getElementById(
        "repo-issues"
    ).textContent =
        formatarNumero(
            resultado.repositorio.issuesAbertas
        );


    document.getElementById(
        "repo-branch"
    ).textContent =
        resultado.repositorio.branchPrincipal;


    document.getElementById(
        "repo-license"
    ).textContent =
        resultado.repositorio.licenca;


    // ==================================================
    // TAGS
    // ==================================================

    preencherTags(
        "stack-list",
        resultado.stack,
        "Não detectada"
    );


    preencherTags(
        "tools-list",
        resultado.ferramentas,
        "Nenhuma detectada"
    );


    preencherTags(
        "infra-list",
        resultado.infraestrutura,
        "Nenhuma detectada"
    );


    // ==================================================
    // PROJETO
    // ==================================================

    document.getElementById(
        "readme-status"
    ).textContent =
        resultado.documentacao.readme
            ? "✓"
            : "✕";


    document.getElementById(
        "docs-status"
    ).textContent =
        resultado.documentacao.pastaDocs
            ? "✓"
            : "✕";


    document.getElementById(
        "tests-status"
    ).textContent =
        resultado.testes.detectados
            ? "✓"
            : "✕";


    document.getElementById(
        "actions-status"
    ).textContent =
        resultado.cicd.githubActions
            ? "✓"
            : "✕";


    // ==================================================
    // LINGUAGENS
    // ==================================================

    const languagesList =
        document.getElementById(
            "languages-list"
        );


    languagesList.replaceChildren();


    const linguagens =
        Object.entries(
            resultado.linguagens
        );


    const total =
        linguagens.reduce(
            (
                soma,
                [, bytes]
            ) =>
                soma + bytes,
            0
        );


    if (!linguagens.length) {

        languagesList.textContent =
            "Nenhuma linguagem detectada.";
    }


    for (
        const [nome, bytes]
        of linguagens
    ) {

        const porcentagem =
            total
                ? (bytes / total) * 100
                : 0;


        const language =
            document.createElement(
                "div"
            );


        language.className =
            "language";


        const top =
            document.createElement(
                "div"
            );


        top.className =
            "language-top";


        const nomeSpan =
            document.createElement(
                "span"
            );


        nomeSpan.textContent =
            nome;


        const porcentagemSpan =
            document.createElement(
                "span"
            );


        porcentagemSpan.textContent =
            `${porcentagem.toFixed(1)}%`;


        top.append(
            nomeSpan,
            porcentagemSpan
        );


        const barra =
            document.createElement(
                "div"
            );


        barra.className =
            "language-bar";


        const progresso =
            document.createElement(
                "div"
            );


        progresso.className =
            "language-progress";


        progresso.style.width =
            `${porcentagem}%`;


        barra.appendChild(
            progresso
        );


        language.append(
            top,
            barra
        );


        languagesList.appendChild(
            language
        );
    }


    // ==================================================
    // DEPENDÊNCIAS
    // ==================================================

    preencherDependencias(
        "production-dependencies",
        "production-count",
        resultado.dependenciasNode.producao,
        "node"
    );


    preencherDependencias(
        "development-dependencies",
        "development-count",
        resultado.dependenciasNode.desenvolvimento,
        "node"
    );


    preencherDependencias(
        "python-dependencies",
        "python-count",
        resultado.dependencias,
        "python"
    );


    configurarBotaoDependencias();


    // ==================================================
    // ESTRUTURA
    // ==================================================

    document.getElementById(
        "repo-files"
    ).textContent =
        formatarNumero(
            resultado.estatisticas.totalArquivos
        );


    document.getElementById(
        "repo-packages"
    ).textContent =
        resultado.estatisticas.packageJson;


    document.getElementById(
        "repo-requirements"
    ).textContent =
        resultado.estatisticas.requirements;


    document.getElementById(
        "repo-configs"
    ).textContent =
        resultado.configs.length;


    preencherTags(
        "config-files-list",

        resultado.configs.map(
            config =>
                config.caminho
        ),

        "Nenhum arquivo de configuração reconhecido"
    );
    configurarMostrarMaisConfigs();


    // ==================================================
    // DATAS
    // ==================================================

    document.getElementById(
        "repo-created"
    ).textContent =
        formatarData(
            resultado.repositorio.criadoEm
        );


    document.getElementById(
        "repo-updated"
    ).textContent =
        formatarData(
            resultado.repositorio.atualizadoEm
        );


    // ==================================================
    // COMMIT
    // ==================================================

    const commitMessage =
        document.getElementById(
            "commit-message"
        );


    const commitInfo =
        document.getElementById(
            "commit-info"
        );


    if (resultado.ultimoCommit) {

        const mensagem =
            traduzirCommit(
                resultado
                    .ultimoCommit
                    .mensagem
            );


        commitMessage.textContent =
            `O que foi feito: ${mensagem}`;


        commitInfo.textContent =
            `${resultado.ultimoCommit.autor} • ` +
            `${formatarData(
                resultado.ultimoCommit.data
            )}`;


    } else {

        commitMessage.textContent =
            "Nenhum commit encontrado";


        commitInfo.textContent =
            "";
    }


    area.classList.remove(
        "escondido"
    );


    area.scrollIntoView({
        behavior: "smooth",
        block: "start"
    });
}


// ======================================================
// ANALISAR REPOSITÓRIO
// ======================================================

// Só estes JSONs são lidos (são os que o backend permite
// e os que realmente influenciam a análise).
const JSONS_LIDOS = new Set([
    "angular.json",
    "nest-cli.json",
    "firebase.json",
    "vercel.json",
    "tsconfig.json"
]);


async function analisarRepositorio() {

    // Já existe uma análise rodando
    if (analiseEmAndamento) {
        return;
    }

    analiseEmAndamento =
        true;

    console.clear();


    try {

        // ==================================================
        // LOGIN
        // ==================================================

        const autenticado =
            await carregarUsuario();


        if (!autenticado) {

            alert(
                "Entre com sua conta do GitHub antes de analisar."
            );

            return;
        }


        // ==================================================
        // URL
        // ==================================================

        const repoUrl =
            repoInput
                .value
                .trim()
                .replace(
                    /\/+$/,
                    ""
                );


        if (!repoUrl) {

            alert(
                "Cole a URL de um repositório."
            );

            return;
        }


        let url;


        try {

            url =
                new URL(repoUrl);

        } catch {

            alert(
                "Essa URL não é válida."
            );

            return;
        }


        if (
            url.protocol !== "https:" ||
            url.hostname !== "github.com"
        ) {

            alert(
                "Use uma URL de repositório do GitHub."
            );

            return;
        }


        const partes =
            url.pathname
                .split("/")
                .filter(Boolean);


        if (partes.length < 2) {

            alert(
                "Essa URL não parece ser de um repositório."
            );

            return;
        }


        const dono =
            partes[0];


        let repo =
            partes[1];


        if (
            repo.endsWith(".git")
        ) {

            repo =
                repo.slice(
                    0,
                    -4
                );
        }


        // ==================================================
        // BOTÃO
        // ==================================================

        const textoOriginal =
            botao.textContent;


        botao.disabled =
            true;


        botao.textContent =
            "Analisando...";

        iniciarLoadingAnalise();

        try {

            // ==================================================
            // DADOS PRINCIPAIS
            // ==================================================

            const resposta =
                await githubFetch(
                    dono,
                    repo
                );


            const dados =
                await resposta.json();


            atualizarProgresso(
                20,
                "Carregando informações do repositório..."
            );


            const resultado = {
                repositorio: {

                    nome:
                        dados.name,

                    nomeCompleto:
                        dados.full_name,

                    descricao:
                        dados.description,

                    branchPrincipal:
                        dados.default_branch,

                    criadoEm:
                        dados.created_at,

                    atualizadoEm:
                        dados.updated_at,

                    estrelas:
                        dados.stargazers_count ??
                        0,

                    forks:
                        dados.forks_count ??
                        0,

                    issuesAbertas:
                        dados.open_issues_count ??
                        0,

                    licenca:
                        dados.license?.spdx_id ||
                        dados.license?.name ||
                        "Não detectada"
                },


                linguagens: {},

                stack: [],

                ferramentas: [],

                infraestrutura: [],


                dependencias: [],


                dependenciasNode: {

                    producao: {},

                    desenvolvimento: {}
                },


                arquivos: [],

                configs: [],


                estatisticas: {

                    totalArquivos: 0,

                    packageJson: 0,

                    requirements: 0
                },


                documentacao: {

                    readme: false,

                    pastaDocs: false
                },


                cicd: {

                    githubActions: false
                },


                container: {

                    docker: false
                },


                testes: {

                    detectados: false
                },


                ultimoCommit: null
            };


            // ==================================================
            // BUSCAS PRINCIPAIS EM PARALELO
            // ==================================================

            const [
                linguagens,
                ultimoCommit,
                arvoreResultado
            ] =
                await Promise.all([

                    buscarLinguagens(
                        dono,
                        repo
                    ),

                    buscarUltimoCommit(
                        dono,
                        repo
                    ),

                    buscarArvore(
                        dono,
                        repo,
                        dados.default_branch
                    )
                ]);


            resultado.linguagens =
                linguagens;


            resultado.ultimoCommit =
                ultimoCommit;


            atualizarProgresso(
                40,
                "Mapeando arquivos e linguagens..."
            );


            // ==================================================
            // ÁRVORE
            // ==================================================

            if (
                arvoreResultado.truncada
            ) {

                console.warn(
                    "A árvore retornada pelo GitHub foi truncada. " +
                    "O repositório é muito grande e alguns arquivos podem não aparecer."
                );
            }


            for (
                const item
                of arvoreResultado.arquivos
            ) {

                if (
                    item.type !== "blob"
                ) {

                    continue;
                }


                const partesCaminho =
                    item.path.split("/");


                resultado.arquivos.push({

                    nome:
                        partesCaminho[
                            partesCaminho.length -
                            1
                        ],

                    caminho:
                        item.path,

                    tamanho:
                        item.size ??
                        null
                });
            }


            resultado
                .estatisticas
                .totalArquivos =
                resultado.arquivos.length;


            // ==================================================
            // README
            // ==================================================

            resultado.documentacao.readme =
                resultado.arquivos.some(
                    arquivo =>
                        arquivo.nome
                            .toLowerCase()
                            .startsWith(
                                "readme"
                            )
                );


            // ==================================================
            // CONFIGS
            // ==================================================

            resultado.configs =
                detectarConfigs(
                    resultado.arquivos
                );


            // ==================================================
            // REQUIREMENTS
            // ==================================================

            const requirements =
                resultado.arquivos
                    .filter(
                        arquivo =>
                            arquivo.nome
                                .toLowerCase() ===
                            "requirements.txt"
                    )
                    .sort(
                        (a, b) =>
                            a.caminho
                                .split("/")
                                .length -
                            b.caminho
                                .split("/")
                                .length
                    );


            resultado
                .estatisticas
                .requirements =
                requirements.length;


            console.log(
                `requirements.txt encontrados: ${requirements.length}`
            );

            atualizarProgresso(
                60,
                "Analisando dependências Python..."
            );


            // Até 50 manifests Python

            for (
                const arquivo
                of requirements.slice(
                    0,
                    50
                )
            ) {

                const deps =
                    await analisarRequirements(
                        dono,
                        repo,
                        dados.default_branch,
                        arquivo.caminho
                    );


                resultado.dependencias.push(
                    ...deps
                );
            }


            // ==================================================
            // PACKAGE.JSON
            // ==================================================

            const packages =
                resultado.arquivos
                    .filter(
                        arquivo =>
                            arquivo.nome
                                .toLowerCase() ===
                            "package.json"
                    )
                    .sort(
                        (a, b) =>
                            a.caminho
                                .split("/")
                                .length -
                            b.caminho
                                .split("/")
                                .length
                    );


            resultado
                .estatisticas
                .packageJson =
                packages.length;


            console.log(
                `package.json encontrados: ${packages.length}`
            );

            atualizarProgresso(
                75,
                "Analisando dependências Node.js..."
            );


            const packagesAnalisados =
                [];


            // Até 100 package.json.
            // Os mais próximos da raiz entram primeiro.

            for (
                const arquivo
                of packages.slice(
                    0,
                    100
                )
            ) {

                const packageJson =
                    await analisarPackageJson(
                        dono,
                        repo,
                        dados.default_branch,
                        arquivo.caminho
                    );


                if (packageJson) {

                    packagesAnalisados.push(
                        packageJson
                    );
                }
            }


            resultado.dependenciasNode =
                juntarDependenciasNode(
                    packagesAnalisados
                );


            // ==================================================
            // JSONS IMPORTANTES
            // ==================================================

            const jsonsImportantes =
                resultado.configs
                    .filter(
                        arquivo =>
                            JSONS_LIDOS.has(
                                arquivo.nome
                                    .toLowerCase()
                            )
                    )
                    .sort(
                        (a, b) =>
                            a.caminho
                                .split("/")
                                .length -
                            b.caminho
                                .split("/")
                                .length
                    );


            // Até 60 JSONs reconhecidos

            for (
                const arquivo
                of jsonsImportantes.slice(
                    0,
                    60
                )
            ) {

                const json =
                    await lerJsonRepositorio(
                        dono,
                        repo,
                        dados.default_branch,
                        arquivo.caminho
                    );


                if (!json) {

                    continue;
                }


                const nome =
                    arquivo.nome
                        .toLowerCase();


                if (
                    nome ===
                    "angular.json"
                ) {

                    resultado.stack.push(
                        "Angular"
                    );
                }


                if (
                    nome ===
                    "nest-cli.json"
                ) {

                    resultado.stack.push(
                        "NestJS"
                    );
                }


                if (
                    nome ===
                    "firebase.json"
                ) {

                    resultado
                        .infraestrutura
                        .push(
                            "Firebase"
                        );
                }


                if (
                    nome ===
                    "vercel.json"
                ) {

                    resultado
                        .infraestrutura
                        .push(
                            "Vercel"
                        );
                }


                if (
                    nome ===
                    "tsconfig.json"
                ) {

                    resultado.stack.push(
                        "TypeScript"
                    );
                }
            }


            // ==================================================
            // TECNOLOGIAS
            // ==================================================

            atualizarProgresso(
                92,
                "Identificando tecnologias e infraestrutura..."
            );

            detectarTecnologias(
                resultado
            );


            // ==================================================
            // RESULTADO
            // ==================================================

            await finalizarLoadingAnalise();


            mostrarResultado(
                resultado
            );


            console.log(
                "============================"
            );

            console.log(
                "RESULTADO REDDREPOLENS"
            );

            console.log(
                "============================"
            );

            console.log(
                resultado
            );


            // Atualiza contador de API

            carregarRateLimit();


        } finally {

            botao.disabled =
                false;


            botao.textContent =
                textoOriginal;
        }


    } catch (erro) {

        console.error(
            "Erro ReddRepoLens:",
            erro
        );


        // Sem isso a barra de progresso ficava travada após um erro
        cancelarLoadingAnalise();


        alert(
            erro.message ||
            "Ocorreu um erro durante a análise."
        );

    } finally {

        // Libera para uma nova análise (sucesso, erro ou return antecipado)
        analiseEmAndamento =
            false;
    }
}


// ======================================================
// EVENTOS
// ======================================================

botao.addEventListener(
    "click",
    analisarRepositorio
);


repoInput.addEventListener(
    "keydown",
    evento => {

        if (
            evento.key ===
            "Enter"
        ) {

            analisarRepositorio();
        }
    }
);


// ======================================================
// XENOMORFO
// ======================================================

const xenoEyes =
    document.getElementById(
        "xeno-eyes"
    );


function piscarXeno(
    duracao = 170
) {

    if (!xenoEyes) {
        return;
    }


    xenoEyes.classList.add(
        "blink"
    );


    setTimeout(
        () => {

            xenoEyes.classList.remove(
                "blink"
            );

        },
        duracao
    );
}


function acordarXeno() {

    if (!xenoEyes) {
        return;
    }


    // Aparece mais cedo para dar
    // tempo de perceber a animação.

    setTimeout(
        () => {

            xenoEyes.classList.remove(
                "sleeping"
            );


            xenoEyes.classList.add(
                "awake"
            );

        },
        650
    );


    // Primeira piscada

    setTimeout(
        () => {

            piscarXeno(180);

        },
        4000
    );


    // Piscada dupla

    setTimeout(
        () => {

            piscarXeno(130);


            setTimeout(
                () => {

                    piscarXeno(130);

                },
                350
            );

        },
        6800
    );


    // Fica olhando por mais tempo
    // antes de desaparecer.

    setTimeout(
        () => {

            xenoEyes.classList.add(
                "sleeping"
            );

        },
        14000
    );
}


// ======================================================
// INICIALIZAÇÃO
// ======================================================

window.addEventListener(
    "load",
    async () => {

        acordarXeno();


        await carregarUsuario();


        // Limpa ?login=sucesso da URL.

        const url =
            new URL(
                window.location.href
            );


        if (
            url.searchParams.has(
                "login"
            )
        ) {

            url.searchParams.delete(
                "login"
            );


            window.history.replaceState(
                {},
                "",
                url.pathname +
                (
                    url.search
                        ? url.search
                        : ""
                )
            );
        }
    }
);


// ======================================================
// CONFIGURAÇÕES // MOSTRAR MAIS / MENOS
// ======================================================

function configurarMostrarMaisConfigs() {

    const lista =
        document.getElementById(
            "config-files-list"
        );

    const botaoToggle =
        document.getElementById(
            "config-files-toggle"
        );

    if (!lista || !botaoToggle) {
        return;
    }

    const configs =
        Array.from(
            lista.querySelectorAll(".tag")
        );

    const LIMITE = 8;

    // Se tiver 8 ou menos, não precisa do botão
    if (configs.length <= LIMITE) {

        botaoToggle.classList.add("escondido");

        configs.forEach(config => {
            config.style.display = "";
        });

        return;
    }

    let expandido = false;

    function atualizar() {

        configs.forEach(
            (config, indice) => {

                config.style.display =
                    expandido || indice < LIMITE
                        ? ""
                        : "none";
            }
        );

        botaoToggle.textContent =
            expandido
                ? "Mostrar menos ↑"
                : `Mostrar mais ↓ (+${configs.length - LIMITE})`;
    }

    botaoToggle.classList.remove("escondido");

    atualizar();

    botaoToggle.onclick = () => {

        expandido = !expandido;

        atualizar();
    };
}


// ======================================================
// PROGRESSO DA ANÁLISE
// ======================================================

let progressoAtual = 0;

let timerProgresso = null;


function atualizarProgresso(
    porcentagem,
    etapa
) {

    const barra =
        document.getElementById(
            "analysis-progress-bar"
        );

    const porcentagemTexto =
        document.getElementById(
            "analysis-loading-percent"
        );

    const etapaTexto =
        document.getElementById(
            "analysis-loading-step"
        );

    progressoAtual =
        Math.max(
            progressoAtual,
            Math.min(100, porcentagem)
        );

    if (barra) {

        barra.style.width =
            `${progressoAtual}%`;
    }

    if (porcentagemTexto) {

        porcentagemTexto.textContent =
            `${Math.round(progressoAtual)}%`;
    }

    if (etapaTexto && etapa) {

        etapaTexto.textContent =
            etapa;
    }
}


function iniciarLoadingAnalise() {

    const loading =
        document.getElementById(
            "analysis-loading"
        );

    const resultado =
        document.getElementById(
            "resultado"
        );

    if (!loading) {
        return;
    }

    // Esconde os resultados antigos
    resultado?.classList.add(
        "escondido"
    );

    loading.classList.remove(
        "escondido"
    );

    progressoAtual = 0;

    atualizarProgresso(
        5,
        "Preparando análise..."
    );

    clearInterval(timerProgresso);

    /*
        Movimento suave enquanto as requisições
        reais estão acontecendo.

        Nunca chega sozinho a 100%.
    */
    timerProgresso =
        setInterval(
            () => {

                if (progressoAtual >= 88) {
                    return;
                }

                let incremento;

                if (progressoAtual < 30) {

                    incremento = 1.2;

                } else if (
                    progressoAtual < 60
                ) {

                    incremento = 0.7;

                } else {

                    incremento = 0.3;
                }

                atualizarProgresso(
                    progressoAtual +
                    incremento
                );

            },
            400
        );
}


async function finalizarLoadingAnalise() {

    clearInterval(timerProgresso);

    timerProgresso = null;

    atualizarProgresso(
        100,
        "Análise concluída."
    );

    await new Promise(
        resolve =>
            setTimeout(
                resolve,
                350
            )
    );

    const loading =
        document.getElementById(
            "analysis-loading"
        );

    loading?.classList.add(
        "escondido"
    );
}


function cancelarLoadingAnalise() {

    clearInterval(timerProgresso);

    timerProgresso = null;

    const loading =
        document.getElementById(
            "analysis-loading"
        );

    loading?.classList.add(
        "escondido"
    );
}
