/** Demo operator identity — email only.
 *  Used solely to recognize the demo operator in the UI (see demoAdminAccess.js).
 *  The password is NEVER shipped in the bundle: on a demo instance the prefill
 *  values are served by GET /api/bootstrap, and outside demo mode they do not
 *  exist at all. */
export const DEMO_CREDENTIALS = {
  email: 'thesuperuser@helm.local',
  name: 'TheSuperUser',
};
