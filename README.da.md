# Contribution Canvas — dansk introduktion

Contribution Canvas er et open-source og local-first værktøj til at tegne **gennemsigtig contribution graph art**. Den offentlige GitHub Pages-side kan bruges til at tegne, placere pixeltekst samt importere og eksportere planer. Den kan ikke læse repositories eller pushe.

GitHub-delen bliver først låst op, når projektet køres lokalt:

```bash
git clone https://github.com/Goprogabriel/contribution-canvas.git
cd contribution-canvas
gh auth login
npm start
```

## Sådan opdaterer du din GitHub-profil

1. Brug GitHub Pages-siden til at tegne dit mønster. Den offentlige side kan ikke logge ind på GitHub eller pushe noget.
2. Vælg **Export** for at gemme planen som en JSON-fil, hvis du vil fortsætte lokalt.
3. Installer [GitHub CLI](https://cli.github.com/) og kør `gh auth login`.
4. Kør kommandoerne ovenfor, og importer eventuelt din JSON-plan i den lokale version.
5. Vælg et dedikeret repository, kør preflight og dry-run, og kontrollér totalen.
6. Skriv det præcise antal commits i bekræftelsesfeltet, og vælg **Generate & push once**.
7. Tjek profilen senere. GitHub kan bruge op til 24 timer på at vise ændringen i contribution graph.

Contribution Canvas ændrer ikke eksisterende aktivitet. Det laver tydeligt markerede graph-art commits i det valgte repository, og der bruges aldrig force-push.

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
