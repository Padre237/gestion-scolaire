// Outils communs des commandes de démonstration (prompt § 6) : questions, arguments, accès à la base.
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

export function argument(nom: string): string | undefined {
  const i = process.argv.indexOf(`--${nom}`);
  if (i >= 0) return process.argv[i + 1];
  const env = process.env[`GS_${nom.toUpperCase().replaceAll('-', '_')}`];
  return env || undefined;
}

export const drapeau = (nom: string) => process.argv.includes(`--${nom}`);

export async function demander(question: string, defaut?: string, cache = false): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout, terminal: true });
  if (cache) {
    // Le mot de passe ne s'affiche pas pendant la frappe.
    const ecrire = (rl as unknown as { _writeToOutput: (s: string) => void });
    const origine = ecrire._writeToOutput.bind(rl);
    let enQuestion = true;
    ecrire._writeToOutput = (s: string) => { if (enQuestion) origine(s); else origine('*'.repeat(s.length > 0 && s !== '\r\n' && s !== '\n' ? 1 : 0)); };
    const r = rl.question(`${question} : `).then((v) => { enQuestion = false; return v; });
    enQuestion = false;
    const v = await r;
    rl.close();
    stdout.write('\n');
    return v;
  }
  const v = await rl.question(`${question}${defaut ? ` [${defaut}]` : ''} : `);
  rl.close();
  return v.trim() || defaut || '';
}

export function sortir(message: string, code = 1): never {
  console.error(message);
  process.exit(code);
}
