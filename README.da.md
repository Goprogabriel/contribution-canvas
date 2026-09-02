# Contribution Canvas — dansk introduktion

Contribution Canvas er et open-source og local-first værktøj til at tegne **gennemsigtig contribution graph art**. Den offentlige GitHub Pages-side kan bruges til at tegne, placere pixeltekst samt importere og eksportere planer. Den kan ikke læse repositories eller pushe.

GitHub-delen bliver først låst op, når projektet køres lokalt:

```bash
git clone https://github.com/Goprogabriel/contribution-canvas.git
cd contribution-canvas
gh auth login
npm start
```

Den lokale Node-proces bruger GitHub CLI. Browseren får aldrig adgang til GitHub-tokenet. Systemet arbejder i en midlertidig clone, kontrollerer remote-branchen igen og udfører højst én almindelig fast-forward push. Der bruges aldrig force-push.

## Det vigtigste

- Pensel og viskelæder med drag.
- Styrke `1–5` som standard og valgfrit maksimum.
- Pixeltekst i `3×5` og `5×7`.
- Live preview, centrering og placering med færrest overlap.
- Undo/redo, tastaturstyring og lokal autosave.
- År, rullende periode eller egen periode samt valgt tidszone.
- Visning af eksisterende GitHub-aktivitet i lokal tilstand.
- Preflight, dry-run, præcis bekræftelse og én verificeret push.
- Fed offentlig hjemmeside gratis via GitHub Pages.

Genererede commits er tydeligt markeret som graph art og skal ikke fremstilles som almindelig udviklingsaktivitet. GitHub bestemmer den endelige farve og kan være op til 24 timer om at opdatere grafen.

Den komplette tekniske dokumentation og alle kommandoer findes i [README.md](README.md).
