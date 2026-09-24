# Sua Historinha — Vercel / Amplo Pay

Frontend estático com funções Node.js em `api/`. Importar este repositório na Vercel, preset **Other**, diretório raiz do repositório, sem build command e sem sobrescrever o output directory. As funções usam Node 22.

## Configuração

Em Settings → Environment Variables, configurar **Production** (e Preview caso queira testar nesse ambiente):

- `AMPLO_PUBLIC_KEY`: credencial enviada no header `x-public-key`.
- `AMPLO_SECRET_KEY`: credencial enviada no header `x-secret-key`.

Ambas são exigidas pela documentação da Amplo Pay. Não usar chaves da XPag. Após alterar variáveis, fazer Redeploy. Nenhuma chave deve ser adicionada ao repositório ou a variáveis públicas do frontend.

## Rotas implementadas

- `POST /api/criar-pix`: calcula o preço, valida cliente e chama `/gateway/pix/receive`.
- `POST /api/criar-cartao`: valida endereço, cartão e IP obtido da Vercel; chama `/gateway/card/receive`. Disponível em 1 parcela. Nunca registra o payload de cartão.
- `POST /api/status`: consulta manual e autenticada por ticket assinado retornado ao criar o pagamento; somente COMPLETED com valor e moeda corretos libera a tela de confirmação.
- `GET /api/config`: configuração pública sem credenciais.

Os preços ficam em `lib/payment.js` e devem acompanhar os valores exibidos no frontend. O desconto de R$25 é uma promoção pública; adicionais são calculados no servidor. `OK` da criação não equivale a pagamento confirmado. Falha ambígua de rede bloqueia nova tentativa na mesma tela; conferir a operação no painel antes de repetir. Não existe garantia de idempotência documentada neste código; não realizar retries automáticos de cobranças.

## Limites atuais

Consulta é manual pelo botão “Já paguei — verificar confirmação”, com intervalo de um minuto na interface. Não há polling automático da Amplo Pay. Não há banco, webhook, fila de geração nem envio automático do livro implementados. Os dados do quiz NÃO são salvos de forma durável; esta versão não é um fluxo completo de entrega e não deve receber pedidos comerciais antes dessa etapa. A mensagem de dez horas é apenas a tela de confirmação.

Para produção completa, adicionar armazenamento durável, idempotência e controle de frequência no servidor, webhook validado e processamento de entrega. O formulário de cartão envia dados diretamente à função por HTTPS: habilitar comercialmente somente com os requisitos da adquirente atendidos; não ativar captura de formulários ou logs de corpo de requisição. O código usa o IPv4 confiável informado pela Vercel; quando não disponível, orienta o comprador a utilizar Pix.

## Verificação

`npm test`: testes com gateway simulado, sem criar cobranças. Nenhum teste de pagamento real foi executado. Para validar uma implantação, verificar o deploy concluído, a resposta JSON de `/api/config` e os logs de execução das funções (sem registrar credenciais ou cartões).
