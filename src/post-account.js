// Formuláře Můj účet a Lidé: jméno a e-mail, přihlášená zařízení, přispěvatelé a nastavení přihlášení.
import { identify, requireChief } from "./db-core.js";
import { endOtherSessions, endSessionById, saveLoginSettings } from "./login-db.js";
import { redirect, withError } from "./http.js";
import { createContributor, saveContributorAccess, saveProfile, setContributorActive } from "./users-db.js";

const ACCOUNT = "/redakce/ucet";
const PEOPLE = "/redakce/lide";

async function signedIn(env, request) {
  const { user, sessionId } = await identify(env, request);
  return user ? { user, sessionId } : null;
}

export async function accountPost(path, request, env, fields) {
  if (path === `${ACCOUNT}/ulozit`) {
    const result = await saveProfile(env, request, fields);
    if (!result.ok) return redirect(withError(ACCOUNT, result.error));
    return redirect(`${ACCOUNT}?ok=jmeno`);
  }
  if (path === `${ACCOUNT}/odhlasit-zarizeni`) {
    const me = await signedIn(env, request);
    if (!me) return redirect(withError(ACCOUNT, "Přihlaste se do redakce."));
    if (fields.sessionId === me.sessionId) return redirect(withError(ACCOUNT, "Tohle zařízení odhlásíte tlačítkem Odhlásit."));
    if (!(await endSessionById(env, me.user.id, fields.sessionId))) return redirect(withError(ACCOUNT, "To zařízení už přihlášené není."));
    return redirect(`${ACCOUNT}?ok=zarizeni`);
  }
  if (path === `${ACCOUNT}/odhlasit-ostatni`) {
    const me = await signedIn(env, request);
    if (!me) return redirect(withError(ACCOUNT, "Přihlaste se do redakce."));
    await endOtherSessions(env, me.user.id, me.sessionId);
    return redirect(`${ACCOUNT}?ok=zarizeni-ostatni`);
  }

  if (path === `${PEOPLE}/ulozit`) {
    const result = await createContributor(env, request, fields);
    if (!result.ok) return redirect(withError(PEOPLE, result.error));
    return redirect(`${PEOPLE}?ok=clovek`);
  }
  if (path === `${PEOPLE}/stav`) {
    const result = await setContributorActive(env, request, fields);
    if (!result.ok) return redirect(withError(PEOPLE, result.error));
    return redirect(`${PEOPLE}?ok=${result.active ? "clovek-zapnut" : "clovek-vypnut"}`);
  }
  if (path === `${PEOPLE}/udaje`) {
    const result = await saveContributorAccess(env, request, fields);
    if (!result.ok) return redirect(withError(PEOPLE, result.error));
    return redirect(`${PEOPLE}?ok=clovek-udaje`);
  }
  if (path === `${PEOPLE}/prihlaseni`) {
    const gate = await requireChief(env, request);
    if (!gate.ok) return redirect(withError(PEOPLE, gate.error));
    const result = await saveLoginSettings(env, fields);
    if (!result.ok) return redirect(withError(PEOPLE, result.error));
    return redirect(`${PEOPLE}?ok=prihlaseni`);
  }
  return null;
}
