# cancelliere

editor json collegato a github, parte dell'infrastruttura di [insidegubbio](https://github.com/insidegubbio).

demo/produzione: [cancelliere.insidegubbio.com](https://cancelliere.insidegubbio.com)

## cosa fa

cancelliere è un editor web per file json che si autentica su github (via oauth) e permette di modificare direttamente i contenuti versionati in un repository, senza dover lavorare a mano sul codice sorgente grezzo. è pensato per chi gestisce i dati/contenuti di insidegubbio ma non necessariamente scrive codice.

l'editor sfrutta [tiptap](https://tiptap.dev/) per un'interfaccia di editing ricca (tabelle, formattazione, ecc.) sopra la struttura dati json.

## stack tecnico

- build tool: [vite](https://vitejs.dev/)
- editor: tiptap (`@tiptap/core`, `starter-kit`, estensioni tabelle e underline)
- autenticazione: flusso oauth github (`api/oauth`)
- linguaggio: javascript (es modules)

## struttura del progetto

```
.
├── api/oauth/     # endpoint serverless per il flusso di autenticazione github oauth
├── src/           # sorgente dell'applicazione
├── index.html     # entry point
├── style.css      # stili
└── package.json
```

## sviluppo locale

```bash
# installa le dipendenze
npm install

# avvia il server di sviluppo
npm run dev

# build di produzione
npm run build

# anteprima della build
npm run preview
```

## licenza

distribuito con licenza [gpl-3.0](./LICENSE).
