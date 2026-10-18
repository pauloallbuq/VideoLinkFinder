# Video Link Finder

Aplicação local para localizar referências públicas a recursos de vídeo em sites que você possui ou tem autorização para analisar. React/Vite no frontend, Node.js + TypeScript/Express no backend, Cheerio para HTML, Playwright para páginas renderizadas e SQLite para histórico.

## Requisitos
- Node.js 20 ou superior (recomendado)
- npm
- Acesso à internet para analisar fontes públicas

## Instalação
```bash
npm install
npx playwright install chromium
cp .env.example .env
npm run dev
```
Abra `http://localhost:5173`. A API local usa `http://localhost:8787`.

## Build e testes
```bash
npm test
npm run build
npm start
```
O banco `video-link-finder.sqlite` é criado automaticamente no diretório atual.

## Uso
1. Informe uma URL HTTP/HTTPS pública.
2. Escolha profundidade de 0 a 5 e limite de páginas (máximo padrão 100).
3. Inicie a busca e aguarde os resultados.
4. Exporte TXT ou CSV.

A ferramenta procura URLs explícitas em `video`, `source`, metadados Open Graph e referências públicas no HTML. Classifica MP4, HLS/M3U8, DASH/MPD e WebM. A validação usa requisição HEAD e não garante que o vídeo completo esteja reproduzível. Alguns servidores bloqueiam HEAD, exigem CORS, usam URLs temporárias ou entregam playlists que dependem de segmentos adicionais.

## Segurança e limites
- Bloqueia esquemas diferentes de HTTP/HTTPS, credenciais embutidas, localhost e endereços IP privados/reservados.
- Verifica URLs encontradas e redirecionamentos antes de prosseguir; redirecionamentos HTTP são sinalizados e não seguidos automaticamente.
- Profundidade limitada a 5, até 100 páginas por busca, timeout configurável e concorrência serial.
- Não faz login, não coleta cookies/senhas, não extrai tokens de sessão, não contorna DRM, paywalls nem autenticação.
- Analisa somente referências expostas publicamente pelo documento; não tenta descobrir endpoints privados nem interceptar sessões autenticadas.
- Use apenas em fontes autorizadas e respeite termos de uso, direitos autorais, robots.txt e limites do site.

## Exemplo autorizado de teste
Use um site de demonstração sob seu controle que contenha uma tag como:
```html
<title>Vídeo de demonstração</title>
<video controls><source src="/media/demo.mp4" type="video/mp4"></video>
```
O exemplo de URL pré-preenchido na interface aponta para um MP4 público de demonstração; como é um arquivo direto e não uma página HTML, ele pode ser reconhecido como recurso de mídia, mas não há título editorial a extrair da página.

## Limitações atuais
- Não é um indexador universal: JavaScript ofuscado, players fechados, DRM, assinaturas temporárias e fontes que escondem os endereços não são suportados.
- O estado VALIDADO significa que o endpoint respondeu com sucesso à requisição HEAD, não que a reprodução integral foi comprovada.
- A extração de links internos fica restrita ao mesmo domínio/origem da URL inicial para reduzir riscos e escopo.
- A proteção DNS é uma camada defensiva; para uso público em produção, execute em ambiente isolado, aplique firewall de saída e revalide destinos em todas as conexões/redirecionamentos.
- Histórico SQLite guarda URL e resultados, sem credenciais ou cookies.

## APK Android
O APK é gerado automaticamente pelo GitHub Actions (`.github/workflows/android.yml`) a cada push na `main` e publicado na release `latest`.
No app Android a varredura roda direto no aparelho (sem servidor): HTTP nativo via Capacitor, parsing com DOMParser, mesmas proteções de URL. Diferenças: sem renderização Playwright, sem verificação DNS de IP privado (só hostname/IP literal), redirecionamentos seguidos pelo cliente nativo e revalidados no destino final, exportação TXT/CSV via compartilhamento do Android.
Build local: `npm install && npm run build:mobile && cd android && ./gradlew assembleDebug`.
