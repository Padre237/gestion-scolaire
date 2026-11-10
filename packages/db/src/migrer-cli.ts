// pnpm migrer : applique les migrations à la base configurée dans var/config.json.
import { lireOuCreerConfig } from './config.ts';
import { creerBase, migrer } from './migrer.ts';

const config = lireOuCreerConfig();
await creerBase(config.pg, config.pg.base);
await migrer(config.pg, config.pg.base, (m) => console.log(m));
console.log('Base à jour.');
