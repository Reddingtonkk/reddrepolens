import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "crypto";
import fs from "fs";
import session from "express-session";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ======================================================
// CONFIGURAÇÃO
// ======================================================

const isProd = process.env.NODE_ENV === "production";

const PORT = Number(process.env.PORT) || 3000;

const FRONTEND_URL = (
    process.env.FRONTEND_URL || `http://localhost:${PORT}`
).replace(/\/+$/, "");

const CALLBACK_URL =
    process.env.GITHUB_CALLBACK_URL ||
    `http://localhost:${PORT}/auth/github/callback`;

const CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const SESSION_SECRET = process.env.SESSION_SECRET;

const SESSION_DIAS = Number(process.env.SESSION_DAYS) || 30;

// Quantos proxies existem entre o usuário e o Node
// (Render, Railway, Nginx, Cloudflare... normalmente 1).
const TRUST_PROXY =
    process.env.TRUST_PROXY !== undefined
        ? Number(process.env.TRUST_PROXY)
        : isProd
            ? 1
            : 0;

const ORIGEM_PRINCIPAL = new URL(FRONTEND_URL).origin;

const ORIGENS_PERMITIDAS = (
    process.env.ALLOWED_ORIGINS || ORIGEM_PRINCIPAL
)
    .split(",")
    .map(o => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);


// ======================================================
// CHECAGEM DO .ENV
// ======================================================

const variaveisAusentes = [];

if (!CLIENT_ID) variaveisAusentes.push("GITHUB_CLIENT_ID");
if (!CLIENT_SECRET) variaveisAusentes.push("GITHUB_CLIENT_SECRET");
if (!SESSION_SECRET) variaveisAusentes.push("SESSION_SECRET");

if (variaveisAusentes.length) {
    console.error(
        "Variáveis ausentes no .env:",
        variaveisAusentes.join(", ")
    );
    process.exit(1);
}

if (isProd) {
    const problemas = [];

    if (SESSION_SECRET.length < 32) {
        problemas.push("SESSION_SECRET precisa ter pelo menos 32 caracteres.");
    }

    if (!FRONTEND_URL.startsWith("https://")) {
        problemas.push("FRONTEND_URL precisa ser https:// em produção.");
    }

    if (!CALLBACK_URL.startsWith("https://")) {
        problemas.push("GITHUB_CALLBACK_URL precisa ser https:// em produção.");
    }

    if (problemas.length) {
        console.error("Configuração insegura para produção:");
        problemas.forEach(p => console.error(" -", p));
        process.exit(1);
    }
} else if (SESSION_SECRET.length < 16) {
    console.warn("Aviso: SESSION_SECRET muito curto. Use um valor aleatório longo.");
}


// ======================================================
// EXPRESS BÁSICO
// ======================================================

app.disable("x-powered-by");

if (TRUST_PROXY > 0) {
    app.set("trust proxy", TRUST_PROXY);
}

// Health check simples (sem dados sensíveis).
app.get("/healthz", (req, res) => {
    res.json({ ok: true });
});

// Em produção, tudo precisa ir por HTTPS.
if (isProd && process.env.FORCE_HTTPS !== "false") {
    app.use((req, res, next) => {
        if (req.secure) {
            return next();
        }

        // Usa o domínio configurado, nunca o header Host recebido.
        res.redirect(301, `${ORIGEM_PRINCIPAL}${req.originalUrl}`);
    });
}


// ======================================================
// SECURITY HEADERS (HELMET + CSP)
// ======================================================

app.use(
    helmet({
        contentSecurityPolicy: {
            useDefaults: true,
            directives: {
                "default-src": ["'self'"],
                "script-src": ["'self'"],
                "style-src": ["'self'"],
                "img-src": [
                    "'self'",
                    "data:",
                    "https://avatars.githubusercontent.com"
                ],
                "connect-src": ["'self'"],
                "object-src": ["'none'"],
                "base-uri": ["'self'"],
                "form-action": ["'self'"],
                "frame-ancestors": ["'none'"],

                // Em localhost (http) isso quebraria o CSS/JS.
                "upgrade-insecure-requests": isProd ? [] : null
            }
        },

        hsts: isProd
            ? {
                maxAge: 15552000,
                includeSubDomains: true
            }
            : false,

        referrerPolicy: {
            policy: "no-referrer"
        }
    })
);


// ======================================================
// CORS (só origens autorizadas)
// ======================================================

app.use(
    cors({
        origin: ORIGENS_PERMITIDAS,
        credentials: true,
        methods: ["GET", "POST"]
    })
);


// ======================================================
// LOG SEGURO (sem query string, sem cookies, sem tokens)
// ======================================================

app.use((req, res, next) => {
    const inicio = Date.now();

    res.on("finish", () => {
        console.log(
            `${req.method} ${req.path} ${res.statusCode} ${Date.now() - inicio}ms`
        );
    });

    next();
});


// ======================================================
// RATE LIMIT DO SEU SERVIDOR
// (independente do limite de 5.000/h do GitHub)
// ======================================================

function criarLimiter({ minutos, limite, mensagem }) {
    return rateLimit({
        windowMs: minutos * 60 * 1000,
        limit: limite,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        handler: (req, res) => {
            res.status(429).json({ erro: mensagem });
        }
    });
}

const limiterPaginas = criarLimiter({
    minutos: 15,
    limite: 300,
    mensagem: "Muitas requisições. Tente novamente em alguns minutos."
});

const limiterAuth = criarLimiter({
    minutos: 15,
    limite: 30,
    mensagem: "Muitas tentativas de login. Tente novamente em alguns minutos."
});

const limiterLeve = criarLimiter({
    minutos: 10,
    limite: 300,
    mensagem: "Muitas requisições. Tente novamente em alguns minutos."
});

// Cada "análise" começa com UMA chamada em /repos/:owner/:repo.
const limiterAnalise = criarLimiter({
    minutos: 10,
    limite: 20,
    mensagem: "Muitas análises seguidas. Aguarde alguns minutos."
});

const limiterGithub = criarLimiter({
    minutos: 10,
    limite: 200,
    mensagem: "Muitas requisições ao GitHub. Aguarde alguns minutos."
});

// Uma análise grande pode ler ~200 arquivos (manifests/configs).
const limiterArquivos = criarLimiter({
    minutos: 10,
    limite: 800,
    mensagem: "Muitos arquivos lidos. Aguarde alguns minutos."
});


// ======================================================
// LIMITE DE REQUISIÇÕES SIMULTÂNEAS POR USUÁRIO
// ======================================================

const emAndamento = new Map();

function limitarConcorrencia(maximo) {
    return (req, res, next) => {
        const chave =
            req.session?.githubUser?.login || req.ip;

        const atual = emAndamento.get(chave) || 0;

        if (atual >= maximo) {
            return res.status(429).json({
                erro:
                    "Muitas requisições simultâneas. Espere a análise atual terminar."
            });
        }

        emAndamento.set(chave, atual + 1);

        let liberado = false;

        const liberar = () => {
            if (liberado) return;
            liberado = true;

            const restante = (emAndamento.get(chave) || 1) - 1;

            if (restante <= 0) {
                emAndamento.delete(chave);
            } else {
                emAndamento.set(chave, restante);
            }
        };

        res.on("finish", liberar);
        res.on("close", liberar);

        next();
    };
}


// ======================================================
// FRONTEND (somente arquivos explicitamente permitidos)
// ======================================================
// Antes: express.static(__dirname) expunha server.js,
// package.json e todo o projeto. Agora só estes três
// arquivos saem do servidor. Nomes são procurados sem
// diferenciar maiúsculas/minúsculas (Windows x Linux).

function localizarArquivo(nome) {
    const alvo = nome.toLowerCase();

    const encontrado = fs
        .readdirSync(__dirname)
        .find(arquivo => arquivo.toLowerCase() === alvo);

    return encontrado
        ? path.join(__dirname, encontrado)
        : null;
}

const PAGINAS_PUBLICAS = {
    "/": "index.html",
    "/Style.css": "style.css",
    "/script.js": "script.js",
    "/favicon.ico": "favicon.ico"
};

for (const [rota, arquivo] of Object.entries(PAGINAS_PUBLICAS)) {

    app.get(rota, limiterPaginas, (req, res) => {

        const caminho = localizarArquivo(arquivo);

        if (!caminho) {
            return res
                .status(404)
                .type("text/plain")
                .send("Arquivo não encontrado.");
        }

        res.sendFile(caminho);
    });
}

app.get("/favicon.ico", (req, res) => {
    res.status(204).end();
});

// Opcional: se um dia criar uma pasta "public/" com imagens/fontes,
// ela será servida automaticamente (e só ela).
const PASTA_PUBLIC = path.join(__dirname, "public");

if (fs.existsSync(PASTA_PUBLIC)) {
    app.use(
        express.static(PASTA_PUBLIC, {
            index: false,
            dotfiles: "deny"
        })
    );
}


// ======================================================
// BODY
// ======================================================

app.use(
    express.json({
        limit: "10kb"
    })
);


// ======================================================
// SESSÃO
// ======================================================

const COOKIE_NOME = isProd
    ? "__Host-reddrepolens.sid"
    : "reddrepolens.sid";

const COOKIE_BASE = {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/"
};

// Store persistente (produção). Sem REDIS_URL cai no MemoryStore,
// que perde todas as sessões a cada restart e vaza memória.
// Para usar:  npm install connect-redis redis
let store;

if (process.env.REDIS_URL) {

    try {

        const { createClient } = await import("redis");
        const { RedisStore } = await import("connect-redis");

        const redis = createClient({
            url: process.env.REDIS_URL
        });

        redis.on("error", erro => {
            console.error("Redis:", erro.message);
        });

        await redis.connect();

        store = new RedisStore({
            client: redis,
            prefix: "reddrepolens:sess:",
            ttl: SESSION_DIAS * 24 * 60 * 60
        });

        console.log("Sessões: Redis.");

    } catch (erro) {

        console.error(
            "Não foi possível iniciar o Redis:",
            erro.message
        );

        if (isProd) {
            process.exit(1);
        }
    }
}

if (!store) {
    console.warn(
        isProd
            ? "ATENÇÃO: produção usando MemoryStore. Configure REDIS_URL."
            : "Sessões: MemoryStore (ok para desenvolvimento)."
    );
}

app.use(
    session({
        name: COOKIE_NOME,
        secret: SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        rolling: true,
        store,

        cookie: {
            ...COOKIE_BASE,
            maxAge: 1000 * 60 * 60 * 24 * SESSION_DIAS
        }
    })
);


// Nada de /api e /auth fica em cache do navegador/proxy.
app.use(["/api", "/auth"], (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
});


// ======================================================
// HELPERS
// ======================================================

const IDENTIFICADOR_SEGURO = /^(?!\.+$)[A-Za-z0-9_.-]{1,100}$/;
const SEGMENTO_REF = /^[A-Za-z0-9._@+-]{1,100}$/;
const REF_SEGURA = /^[A-Za-z0-9._\/@+-]{1,200}$/;

// Só estes arquivos podem ser lidos por /api/file
// (são exatamente os que o analisador usa).
const ARQUIVOS_PERMITIDOS = new Set([
    "package.json",
    "requirements.txt",
    "angular.json",
    "nest-cli.json",
    "firebase.json",
    "vercel.json",
    "tsconfig.json"
]);

const LIMITE_ARQUIVO = 2 * 1024 * 1024;
const TIMEOUT_GITHUB_MS = 15000;


function criarHeadersGitHub(token) {

    const headers = {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "ReddRepoLens"
    };

    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }

    return headers;
}


function requisitarGitHub(url, token) {

    return fetch(url, {
        headers: criarHeadersGitHub(token),
        signal: AbortSignal.timeout(TIMEOUT_GITHUB_MS)
    });
}
app.get("/api/search", limiterGithub, exigirLogin, async (req, res) => {
    const pesquisa = String(req.query.q || "").trim();

    if (!pesquisa || pesquisa.length > 100) {
        return res.status(400).json({
            erro: "Digite uma pesquisa de até 100 caracteres."
        });
    }

    try {
        const parametros = new URLSearchParams({
            q: pesquisa,
            per_page: "10"
        });

        const resposta = await requisitarGitHub(
            `https://api.github.com/search/repositories?${parametros}`,
            req.session.githubToken
        );

        if (!resposta.ok) {
            return res.status(resposta.status).json({
                erro: "Não foi possível pesquisar os repositórios."
            });
        }

        const dados = await resposta.json();

        const repositorios = dados.items.map(repo => ({
            nome: repo.full_name,
            descricao: repo.description,
            linguagem: repo.language,
            estrelas: repo.stargazers_count,
            url: repo.html_url
        }));

        res.json({ repositorios });

    } catch (erro) {
        responderErro(res, erro, "Pesquisa de repositórios");
    }
});


function usuarioAutenticado(req) {

    return Boolean(
        req.session?.githubToken &&
        req.session?.githubUser
    );
}


function exigirLogin(req, res, next) {

    if (!usuarioAutenticado(req)) {
        return res.status(401).json({
            erro: "Faça login com GitHub antes de analisar."
        });
    }

    next();
}


// Proteção CSRF extra para POST (além do SameSite=Lax).
function verificarOrigem(req, res, next) {

    const origem = req.get("origin");
    const site = req.get("sec-fetch-site");

    if (origem && !ORIGENS_PERMITIDAS.includes(origem)) {
        return res.status(403).json({ erro: "Origem não permitida." });
    }

    if (site && site !== "same-origin" && site !== "none") {
        return res.status(403).json({ erro: "Requisição bloqueada." });
    }

    next();
}


function normalizarPartes(valor, maximo = 12) {

    const lista = Array.isArray(valor) ? valor : [valor];

    const partes = lista
        .flatMap(p => String(p ?? "").split("/"))
        .filter(Boolean);

    if (partes.length > maximo) {
        return null;
    }

    const invalida = partes.some(
        p =>
            p === "." ||
            p === ".." ||
            p.length > 255 ||
            p.includes("\0") ||
            p.includes("\\")
    );

    return invalida ? null : partes;
}


function compararSeguro(a, b) {

    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));

    return (
        bufA.length === bufB.length &&
        crypto.timingSafeEqual(bufA, bufB)
    );
}


function promessaSessao(metodo, req) {

    return new Promise((resolve, reject) => {
        req.session[metodo](erro => {
            if (erro) {
                reject(erro);
                return;
            }
            resolve();
        });
    });
}

const salvarSessao = req => promessaSessao("save", req);
const destruirSessao = req => promessaSessao("destroy", req);


function regenerarSessao(req) {

    return new Promise((resolve, reject) => {
        req.session.regenerate(erro => {
            if (erro) {
                reject(erro);
                return;
            }
            resolve();
        });
    });
}


function responderErro(res, erro, contexto) {

    // Detalhes técnicos ficam só no servidor.
    const timeout =
        erro?.name === "TimeoutError" ||
        erro?.name === "AbortError";

    console.error(
        `${contexto}:`,
        timeout ? "timeout" : erro?.message
    );

    if (res.headersSent) {
        return;
    }

    if (timeout) {
        return res.status(504).json({
            erro: "O GitHub demorou demais para responder."
        });
    }

    res.status(500).json({
        erro: "Erro ao acessar o GitHub."
    });
}


// ======================================================
// LOGIN GITHUB
// ======================================================

app.get(
    "/auth/github",
    limiterAuth,
    async (req, res) => {

        try {

            const state =
                crypto.randomBytes(32).toString("hex");

            req.session.oauthState = state;
            req.session.oauthStateCriadoEm = Date.now();

            await salvarSessao(req);

            const parametros = new URLSearchParams({
                client_id: CLIENT_ID,
                redirect_uri: CALLBACK_URL,
                state,
                scope: "read:user"
            });

            res.redirect(
                "https://github.com/login/oauth/authorize" +
                `?${parametros.toString()}`
            );

        } catch (erro) {

            console.error("Erro iniciando OAuth:", erro.message);

            res
                .status(500)
                .send("Não foi possível iniciar o login com GitHub.");
        }
    }
);


// ======================================================
// CALLBACK GITHUB
// ======================================================

app.get(
    "/auth/github/callback",
    limiterAuth,
    async (req, res) => {

        try {

            const { code, state, error } = req.query;

            if (error) {
                console.warn("OAuth cancelado pelo usuário.");
                return res.redirect(`${FRONTEND_URL}/?login=cancelado`);
            }

            if (typeof code !== "string" || !code) {
                return res
                    .status(400)
                    .send("Código de autorização não recebido.");
            }

            if (typeof state !== "string" || !state) {
                return res
                    .status(400)
                    .send("State OAuth não recebido.");
            }

            const esperado = req.session.oauthState;
            const criadoEm = req.session.oauthStateCriadoEm;

            if (!esperado) {
                return res
                    .status(400)
                    .send("A sessão de login expirou. Tente entrar novamente.");
            }

            // State só vale por 10 minutos e só uma vez.
            delete req.session.oauthState;
            delete req.session.oauthStateCriadoEm;

            if (!criadoEm || Date.now() - criadoEm > 10 * 60 * 1000) {
                return res
                    .status(400)
                    .send("A sessão de login expirou. Tente entrar novamente.");
            }

            if (!compararSeguro(state, esperado)) {
                return res
                    .status(400)
                    .send("Estado OAuth inválido.");
            }

            // ----- code -> token -----

            const tokenResponse = await fetch(
                "https://github.com/login/oauth/access_token",
                {
                    method: "POST",
                    headers: {
                        Accept: "application/json",
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        client_id: CLIENT_ID,
                        client_secret: CLIENT_SECRET,
                        code,
                        redirect_uri: CALLBACK_URL
                    }),
                    signal: AbortSignal.timeout(TIMEOUT_GITHUB_MS)
                }
            );

            if (!tokenResponse.ok) {
                throw new Error(
                    `GitHub OAuth respondeu ${tokenResponse.status}.`
                );
            }

            const tokenData = await tokenResponse.json();

            if (!tokenData.access_token) {
                console.error(
                    "GitHub não retornou access token:",
                    tokenData.error || "sem código de erro"
                );

                return res
                    .status(400)
                    .send("Não foi possível obter o token do GitHub.");
            }

            const githubToken = tokenData.access_token;

            // ----- usuário -----

            const userResponse = await requisitarGitHub(
                "https://api.github.com/user",
                githubToken
            );

            if (!userResponse.ok) {
                throw new Error(
                    `GitHub /user respondeu ${userResponse.status}.`
                );
            }

            const usuario = await userResponse.json();

            if (!usuario.login) {
                throw new Error("GitHub não retornou um usuário válido.");
            }

            // ----- nova sessão (evita session fixation) -----

            await regenerarSessao(req);

            req.session.githubToken = githubToken;

            req.session.githubUser = {
                login: usuario.login,
                avatar: usuario.avatar_url,
                url: usuario.html_url
            };

            await salvarSessao(req);

            console.log(`GitHub conectado: ${usuario.login}`);

            res.redirect(`${FRONTEND_URL}/?login=sucesso`);

        } catch (erro) {

            console.error("Erro OAuth:", erro.message);

            res
                .status(500)
                .send("Erro ao autenticar com GitHub.");
        }
    }
);


// ======================================================
// USUÁRIO LOGADO (nunca devolve o token)
// ======================================================

app.get(
    "/api/me",
    limiterLeve,
    (req, res) => {

        if (!usuarioAutenticado(req)) {
            return res
                .status(401)
                .json({ autenticado: false });
        }

        res.json({
            autenticado: true,
            usuario: req.session.githubUser
        });
    }
);


// ======================================================
// RATE LIMIT DO GITHUB (informativo para o usuário)
// ======================================================

app.get(
    "/api/rate-limit",
    limiterLeve,
    exigirLogin,
    async (req, res) => {

        try {

            const resposta = await requisitarGitHub(
                "https://api.github.com/rate_limit",
                req.session.githubToken
            );

            if (!resposta.ok) {
                return res
                    .status(resposta.status)
                    .json({
                        erro: "GitHub não retornou o limite da API."
                    });
            }

            const dados = await resposta.json();

            const core = dados.resources?.core || dados.rate;

            res.json({
                limite: core?.limit ?? 0,
                restantes: core?.remaining ?? 0,
                usados: core?.used ?? 0,
                reset: core?.reset ?? null
            });

        } catch (erro) {

            responderErro(res, erro, "Erro rate limit");
        }
    }
);


// ======================================================
// PROXY GITHUB (somente endpoints que o analisador usa)
// ======================================================

function montarDestinoGitHub(owner, repo, resto, query) {

    const base =
        "https://api.github.com/repos/" +
        `${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

    // /repos/:owner/:repo
    if (resto.length === 0) {
        return base;
    }

    // /languages
    if (resto.length === 1 && resto[0] === "languages") {
        return `${base}/languages`;
    }

    // /commits?per_page=N (1 a 5)
    if (resto.length === 1 && resto[0] === "commits") {

        const n = Number.parseInt(String(query.per_page ?? "1"), 10);

        const porPagina = Number.isInteger(n)
            ? Math.min(Math.max(n, 1), 5)
            : 1;

        return `${base}/commits?per_page=${porPagina}`;
    }

    // /git/trees/:branch?recursive=1
    if (
        resto[0] === "git" &&
        resto[1] === "trees" &&
        resto.length >= 3 &&
        resto.length <= 8
    ) {

        const ref = resto.slice(2);

        if (!ref.every(segmento => SEGMENTO_REF.test(segmento))) {
            return null;
        }

        return (
            `${base}/git/trees/` +
            ref.map(segmento => encodeURIComponent(segmento)).join("/") +
            "?recursive=1"
        );
    }

    return null;
}


// Conta como "análise nova" só a chamada base /repos/:owner/:repo.
function limitarInicioDeAnalise(req, res, next) {

    const partes = normalizarPartes(req.params.path);

    if (partes && partes.length === 2) {
        return limiterAnalise(req, res, next);
    }

    next();
}


app.get(
    "/api/github/repos/*path",
    limiterGithub,
    limitarInicioDeAnalise,
    exigirLogin,
    limitarConcorrencia(6),
    async (req, res) => {

        try {

            const partes = normalizarPartes(req.params.path);

            if (!partes || partes.length < 2) {
                return res
                    .status(400)
                    .json({ erro: "Repositório inválido." });
            }

            const [owner, repo, ...resto] = partes;

            if (
                !IDENTIFICADOR_SEGURO.test(owner) ||
                !IDENTIFICADOR_SEGURO.test(repo)
            ) {
                return res
                    .status(400)
                    .json({ erro: "Owner ou repositório inválido." });
            }

            const destino = montarDestinoGitHub(
                owner,
                repo,
                resto,
                req.query
            );

            if (!destino) {
                return res
                    .status(404)
                    .json({ erro: "Endpoint não permitido." });
            }

            const resposta = await requisitarGitHub(
                destino,
                req.session.githubToken
            );

            const restantes =
                resposta.headers.get("x-ratelimit-remaining");

            const limite =
                resposta.headers.get("x-ratelimit-limit");

            if (restantes) {
                res.setHeader("X-ReddRepoLens-Remaining", restantes);
            }

            if (limite) {
                res.setHeader("X-ReddRepoLens-Limit", limite);
            }

            // Token revogado/inválido: encerra a sessão local.
            if (resposta.status === 401) {

                await destruirSessao(req).catch(() => { });

                res.clearCookie(COOKIE_NOME, COOKIE_BASE);

                return res
                    .status(401)
                    .json({
                        erro: "Sua sessão do GitHub expirou. Entre novamente."
                    });
            }

            if (!resposta.ok) {

                const status =
                    resposta.status >= 400 && resposta.status < 600
                        ? resposta.status
                        : 502;

                // Corpo genérico: não repassamos mensagens cruas do GitHub.
                return res
                    .status(status)
                    .json({
                        erro: "O GitHub não atendeu a requisição."
                    });
            }

            res.json(await resposta.json());

        } catch (erro) {

            responderErro(res, erro, "Erro GitHub Proxy");
        }
    }
);


// ======================================================
// LEITOR DE ARQUIVOS (somente manifests/configs conhecidos)
// ======================================================

function urlDownloadSegura(valor) {

    try {
        const url = new URL(valor);

        return (
            url.protocol === "https:" &&
            url.hostname === "raw.githubusercontent.com"
        );

    } catch {
        return false;
    }
}


function enviarTexto(res, buffer) {

    res.setHeader("Content-Type", "text/plain; charset=utf-8");

    return res.send(buffer.toString("utf8"));
}


app.get(
    "/api/file",
    limiterArquivos,
    exigirLogin,
    limitarConcorrencia(6),
    async (req, res) => {

        try {

            const { owner, repo, ref, path: caminhoArquivo } = req.query;

            if (
                [owner, repo, ref, caminhoArquivo].some(
                    valor => typeof valor !== "string" || !valor
                )
            ) {
                return res
                    .status(400)
                    .json({ erro: "Parâmetros do arquivo incompletos." });
            }

            if (
                !IDENTIFICADOR_SEGURO.test(owner) ||
                !IDENTIFICADOR_SEGURO.test(repo)
            ) {
                return res
                    .status(400)
                    .json({ erro: "Owner ou repositório inválido." });
            }

            if (!REF_SEGURA.test(ref) || ref.includes("..")) {
                return res
                    .status(400)
                    .json({ erro: "Branch inválida." });
            }

            const partesPath = normalizarPartes(caminhoArquivo, 30);

            if (!partesPath || !partesPath.length) {
                return res
                    .status(400)
                    .json({ erro: "Caminho inválido." });
            }

            const nomeArquivo =
                partesPath[partesPath.length - 1].toLowerCase();

            if (!ARQUIVOS_PERMITIDOS.has(nomeArquivo)) {
                return res
                    .status(403)
                    .json({ erro: "Arquivo não permitido para análise." });
            }

            const caminhoSeguro = partesPath
                .map(parte => encodeURIComponent(parte))
                .join("/");

            const githubUrl =
                "https://api.github.com/repos/" +
                `${encodeURIComponent(owner)}/` +
                `${encodeURIComponent(repo)}/` +
                `contents/${caminhoSeguro}` +
                `?ref=${encodeURIComponent(ref)}`;

            const resposta = await requisitarGitHub(
                githubUrl,
                req.session.githubToken
            );

            if (!resposta.ok) {
                return res
                    .status(resposta.status)
                    .json({ erro: "Não foi possível ler o arquivo." });
            }

            const arquivo = await resposta.json();

            if (Array.isArray(arquivo) || arquivo.type !== "file") {
                return res
                    .status(400)
                    .json({ erro: "O caminho não representa um arquivo." });
            }

            if (arquivo.size && arquivo.size > LIMITE_ARQUIVO) {
                return res
                    .status(413)
                    .json({ erro: "Arquivo grande demais para análise." });
            }

            // ----- conteúdo base64 -----

            if (arquivo.encoding === "base64" && arquivo.content) {

                const buffer = Buffer.from(
                    arquivo.content.replace(/\n/g, ""),
                    "base64"
                );

                if (buffer.length > LIMITE_ARQUIVO) {
                    return res
                        .status(413)
                        .json({ erro: "Arquivo grande demais para análise." });
                }

                return enviarTexto(res, buffer);
            }

            // ----- fallback download_url -----

            if (arquivo.download_url) {

                if (!urlDownloadSegura(arquivo.download_url)) {
                    return res
                        .status(422)
                        .json({ erro: "Origem do arquivo não permitida." });
                }

                const raw = await fetch(arquivo.download_url, {
                    headers: { "User-Agent": "ReddRepoLens" },
                    signal: AbortSignal.timeout(TIMEOUT_GITHUB_MS)
                });

                if (!raw.ok) {
                    return res
                        .status(raw.status)
                        .json({ erro: "Não foi possível baixar o arquivo." });
                }

                const tamanhoDeclarado = Number(
                    raw.headers.get("content-length") || 0
                );

                if (tamanhoDeclarado > LIMITE_ARQUIVO) {
                    return res
                        .status(413)
                        .json({ erro: "Arquivo grande demais para análise." });
                }

                const buffer = Buffer.from(await raw.arrayBuffer());

                if (buffer.length > LIMITE_ARQUIVO) {
                    return res
                        .status(413)
                        .json({ erro: "Arquivo grande demais para análise." });
                }

                return enviarTexto(res, buffer);
            }

            return res
                .status(422)
                .json({
                    erro: "O GitHub não forneceu o conteúdo do arquivo."
                });

        } catch (erro) {

            responderErro(res, erro, "Erro lendo arquivo");
        }
    }
);


// ======================================================
// LOGOUT (POST + checagem de origem)
// ======================================================

app.post(
    "/auth/logout",
    limiterAuth,
    verificarOrigem,
    async (req, res) => {

        try {

            await destruirSessao(req);

            res.clearCookie(COOKIE_NOME, COOKIE_BASE);

            res.json({ sucesso: true });

        } catch (erro) {

            console.error("Erro logout:", erro.message);

            res.status(500).json({ sucesso: false });
        }
    }
);


// ======================================================
// 404
// ======================================================

app.use("/api", (req, res) => {
    res.status(404).json({ erro: "Endpoint não encontrado." });
});

app.use((req, res) => {
    res.status(404).type("text/plain").send("Não encontrado.");
});


// ======================================================
// ERROS (mensagem segura pro usuário, detalhe só no log)
// ======================================================

app.use((erro, req, res, next) => {

    console.error("Erro Express:", erro?.message);

    if (res.headersSent) {
        return next(erro);
    }

    const status = Number(erro?.status || erro?.statusCode) || 500;

    if (status >= 400 && status < 500) {
        return res.status(status).json({ erro: "Requisição inválida." });
    }

    res.status(500).json({ erro: "Erro interno do servidor." });
});


process.on("unhandledRejection", motivo => {
    console.error(
        "Promise rejeitada sem tratamento:",
        motivo?.message || motivo
    );
});


// ======================================================
// SERVIDOR
// ======================================================

const servidor = app.listen(PORT, () => {

    console.log("");
    console.log("======================================");
    console.log("           REDDREPOLENS");
    console.log("======================================");
    console.log(`Modo   : ${isProd ? "PRODUÇÃO" : "desenvolvimento"}`);
    console.log(`Site   : http://localhost:${PORT}`);
    console.log(`OAuth  : ${CALLBACK_URL}`);
    console.log(`CORS   : ${ORIGENS_PERMITIDAS.join(", ")}`);
    console.log(`Sessão : ${store ? "Redis" : "MemoryStore"} (${SESSION_DIAS} dias)`);
    console.log("======================================");
    console.log("");
});

function desligar() {
    console.log("Encerrando servidor...");
    servidor.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGTERM", desligar);
process.on("SIGINT", desligar);
