# Dashboard de Ações

## Arranque

Requer Node.js 22 ou superior.

```bash
npm install
npm run dev
```

Abrir http://localhost:3000

Os perfis ficam guardados localmente em `data/profiles.json` durante o desenvolvimento local.

Tickers Yahoo de exemplo: AAPL, EDP.LS, SAN.MC, SAP.DE, ASML.AS, MC.PA, 7203.T.

Nota: yahoo-finance2 usa uma API não oficial. Serve para uso pessoal e educativo, mas não deve ser tratado como feed garantido de mercado.

## Deploy no Vercel

Para o deploy no Vercel com persistência dos perfis, a aplicação usa **Vercel Blob** em produção.

### 1. Criar e ligar um Blob Store

1. No dashboard da Vercel, abre o projeto
2. Vai a **Storage**
3. Cria um **Blob** com acesso **Private**
4. Liga esse Blob ao projeto nos ambientes **Production** e **Preview**
5. Se também quiseres usar o Blob localmente, liga também ao ambiente **Development**

### 2. Trazer as variáveis para local

Depois de ligares o Blob ao projeto:

```bash
npm i -g vercel
vercel login
vercel link
vercel env pull .env.local
```

Isto traz as variáveis necessárias do Vercel para o desenvolvimento local.

### 3. Fazer deploy

Pelo dashboard:

1. Faz push do projeto para GitHub, GitLab ou Bitbucket
2. Na Vercel, escolhe **Add New Project**
3. Importa o repositório
4. Mantém as opções default de Next.js
5. Faz **Deploy**

Ou pela CLI:

```bash
vercel
vercel --prod
```

### 4. Importante

- Em **local**, sem variáveis do Blob, a app usa `data/profiles.json`
- Em **Vercel**, se o Blob não estiver configurado, a API devolve erro explícito para evitar falsas persistências
