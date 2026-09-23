# ReddRepoLens

Analisador de repositórios do GitHub. Cole a URL de um repositório público e entenda em segundos a stack, as linguagens, as dependências, a infraestrutura, a documentação e a atividade do projeto.

## O que ele analisa

- **Informações gerais:** estrelas, forks, issues abertas, branch principal e licença
- **Stack:** linguagens e frameworks detectados (Node.js, React, Express, Django, Flask, e outros)
- **Linguagens:** porcentagem de cada linguagem no repositório
- **Dependências:** produção e desenvolvimento (`package.json`) e Python (`requirements.txt`), inclusive em monorepos
- **Infraestrutura e ferramentas:** Docker, GitHub Actions, Kubernetes, Vercel, Firebase, ESLint, Jest e outros
- **Projeto:** presença de README, documentação, testes e GitHub Actions
- **Atividade:** datas de criação e atualização e o último commit

## Tecnologias

- **Backend:** Node.js, Express 5, express-session
- **Segurança:** helmet (CSP e headers), express-rate-limit, CORS restrito
- **Frontend:** HTML, CSS e JavaScript puro (sem frameworks)
- **Autenticação:** OAuth do GitHub (escopo mínimo `read:user`)

## Como rodar na sua máquina

### 1. Pré-requisitos

- [Node.js](https://nodejs.org/) 20 ou superior
- [Git](https://git-scm.com/)
- Uma conta no GitHub

### 2. Clone o projeto e instale as dependências

```bash
git clone https://github.com/SEU-USUARIO/reddrepolens.git
cd reddrepolens
npm install
```

### 3. Crie um OAuth App no GitHub

O login usa OAuth, então você precisa registrar um app **seu**:

1. Acesse **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**
2. Preencha:
   - **Application name:** `ReddRepoLens (local)`
   - **Homepage URL:** `http://localhost:3000`
   - **Authorization callback URL:** `http://localhost:3000/auth/github/callback`
3. Clique em **Register application**
4. Copie o **Client ID** e gere um **Client Secret**

### 4. Configure o `.env`

Copie o arquivo de exemplo e preencha:

```bash
# Windows (PowerShell)
Copy-Item .env.example .env

# Linux / macOS
cp .env.example .env
```

Edite o `.env` com o Client ID, o Client Secret e um `SESSION_SECRET` aleatório. Para gerar o `SESSION_SECRET`:

```bash
node -p "require('crypto').randomBytes(48).toString('hex')"
```

> **Nunca** faça commit do arquivo `.env`. Ele já está no `.gitignore`.

### 5. Inicie o servidor

```bash
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000), entre com o GitHub e cole a URL de um repositório público.

## Por que preciso entrar com o GitHub?

As análises leem vários arquivos do repositório pela API do GitHub. Sem autenticação o limite é de 60 requisições por hora. Com login, o limite sobe para 5.000 por hora. O token fica só no servidor e nunca é enviado ao navegador.

## Segurança

- O servidor só entrega `index.html`, `Style.css` e `script.js` (o código do backend não é exposto)
- O proxy da API do GitHub aceita apenas os endpoints que o analisador usa
- Só arquivos de manifesto e configuração conhecidos podem ser lidos, com limite de 2 MB
- Rate limiting por IP e limite de requisições simultâneas por usuário
- Cookies `httpOnly` e `sameSite`, com `secure` e prefixo `__Host-` em produção
- Proteção do fluxo OAuth com `state` de uso único e regeneração de sessão no login
- Headers de segurança e Content Security Policy via helmet
- Erros com mensagem genérica para o usuário e detalhes só no log do servidor

## Estrutura

```
ReddRepoLens/
├── index.html      # página
├── Style.css       # estilos
├── script.js       # lógica do analisador (frontend)
├── server.js       # backend: OAuth, sessão e proxy do GitHub
├── package.json
├── .env.example    # modelo de configuração
└── .gitignore
```

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `GITHUB_CLIENT_ID` | Sim | Client ID do OAuth App |
| `GITHUB_CLIENT_SECRET` | Sim | Client Secret do OAuth App |
| `SESSION_SECRET` | Sim | Texto aleatório longo para assinar a sessão |
| `PORT` | Não | Porta do servidor (padrão `3000`) |
| `FRONTEND_URL` | Não | URL pública do site (padrão `http://localhost:PORT`) |
| `GITHUB_CALLBACK_URL` | Não | Callback do OAuth |
| `SESSION_DAYS` | Não | Duração do login em dias (padrão `30`) |
| `NODE_ENV` | Não | `production` ativa cookies seguros, HTTPS e HSTS |
| `ALLOWED_ORIGINS` | Não | Origens permitidas no CORS |
| `TRUST_PROXY` | Não | Número de proxies na frente do Node (produção) |
| `REDIS_URL` | Não | Store de sessão persistente (produção) |

## Limitações

- Analisa apenas repositórios **públicos**
- Repositórios gigantes podem ter a lista de arquivos truncada pela API do GitHub
- Em desenvolvimento as sessões ficam em memória e somem ao reiniciar o servidor