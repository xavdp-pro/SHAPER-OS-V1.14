import { normalizeLocale } from './locale.js';

/**
 * Périmètre de contrôle (control scope) — la couche SPÉCIALISÉE du contexte
 * agent, par opposition aux skills GÉNÉRIQUES universelles (agentSkills.js).
 *
 * Méthodologie à deux couches :
 *  - GÉNÉRIQUE (agentSkills.js) : méthodes valables partout, quel que soit le
 *    déploiement (ingestion doc, livrables, API-first, orchestration…).
 *  - SPÉCIALISÉ (ce fichier) : ce que CE déploiement contrôle précisément
 *    (domaines Cloudflare, comptes cloud, machines…) — DIFFÉRENT pour chaque
 *    client/installation KovZu, chargé dynamiquement.
 *
 * Aujourd'hui : lu depuis l'env (.env par déploiement). Demain (vault) :
 * remplacer `loadFromEnv()` par un appel au vault du tenant — le reste
 * (fabrique du texte de contexte, injection au prime) ne change pas.
 * Le SECRET (token) n'est JAMAIS injecté en clair dans le contexte LLM :
 * l'agent sait qu'une variable d'env existe et l'utilise depuis ses scripts/
 * commandes shell, jamais recopiée dans le texte de conversation.
 */

function parseList(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Charge le périmètre depuis l'environnement (implémentation actuelle).
 * Remplaçable demain par un chargeur vault sans toucher au reste du module.
 */
function loadFromEnv() {
  const scope = { cloudflare: null };

  const cfToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
  const cfDomains = parseList(process.env.CLOUDFLARE_DOMAINS);
  if (cfToken && cfDomains.length) {
    scope.cloudflare = {
      tokenEnvVar: 'CLOUDFLARE_API_TOKEN', // nom de la variable, jamais la valeur
      domains: cfDomains,
    };
  }

  return scope;
}

let cache = null;
export function getControlScope({ force = false } = {}) {
  if (!cache || force) cache = loadFromEnv();
  return cache;
}

export function invalidateControlScope() {
  cache = null;
}

/**
 * Texte de contexte agent pour le périmètre Cloudflare — généré dynamiquement
 * à partir du scope courant. Ne cite jamais le token, seulement son nom de
 * variable d'env (déjà exportée dans le shell/scripts de l'agent).
 */
function cloudflareDirective(scope, locale) {
  const cf = scope.cloudflare;
  if (!cf) return '';
  const domains = cf.domains.join(', ');
  const lang = normalizeLocale(locale);
  if (lang === 'en') {
    return `• Cloudflare control: you MANAGE tunnels/DNS/subdomains for: ${domains}. Use the Cloudflare API with the token already exported as $${cf.tokenEnvVar} in your shell/scripts (curl -H "Authorization: Bearer $${cf.tokenEnvVar}" https://api.cloudflare.com/client/v4/...) — never print, log, or paste the token value itself; refer to it only as $${cf.tokenEnvVar}. You may create/update/delete tunnels and subdomains on these domains as needed.`;
  }
  if (lang === 'es') {
    return `• Control Cloudflare: GESTIONAS túneles/DNS/subdominios para: ${domains}. Usa la API de Cloudflare con el token ya exportado como $${cf.tokenEnvVar} en tu shell/scripts (curl -H "Authorization: Bearer $${cf.tokenEnvVar}" https://api.cloudflare.com/client/v4/...) — nunca muestres, registres ni pegues el valor del token; refiérete a él solo como $${cf.tokenEnvVar}. Puedes crear/modificar/eliminar túneles y subdominios en estos dominios según haga falta.`;
  }
  return `• Contrôle Cloudflare : tu GÈRES les tunnels/DNS/sous-domaines pour : ${domains}. Utilise l'API Cloudflare avec le token déjà exporté dans la variable $${cf.tokenEnvVar} de ton shell/scripts (curl -H "Authorization: Bearer $${cf.tokenEnvVar}" https://api.cloudflare.com/client/v4/...) — ne jamais afficher, logger ou recopier la valeur du token ; réfère-toi y uniquement par $${cf.tokenEnvVar}. Tu peux créer/modifier/supprimer des tunnels et sous-domaines sur ces domaines selon le besoin.`;
}

/**
 * Bloc de contexte "PÉRIMÈTRE DE CONTRÔLE" — injecté au prime, après les
 * skills génériques. Vide (chaîne '') si rien n'est configuré pour ce
 * déploiement — un futur client sans accès Cloudflare n'a simplement pas ce
 * bloc, sans code différent.
 */
export function buildControlScopeContext(locale = 'fr') {
  const scope = getControlScope();
  const lines = [cloudflareDirective(scope, locale)].filter(Boolean);
  if (!lines.length) return '';
  const lang = normalizeLocale(locale);
  const header = lang === 'en'
    ? 'PÉRIMÈTRE DE CONTRÔLE (this deployment — differs per client, adaptive) :'
    : lang === 'es'
      ? 'PÉRIMÈTRE DE CONTRÔLE (este despliegue — difiere por cliente, adaptativo):'
      : 'PÉRIMÈTRE DE CONTRÔLE (ce déploiement — diffère par client, adaptatif) :';
  return [header, ...lines].join('\n');
}
