/**
 * Eid al-Adha (RFC-020 §3.3): Dhu al-Hijjah 10, four days. The same feast
 * look as Eid al-Fitr (./eid-al-fitr.tsx): lanterns and sparkles rising,
 * string lights and lanterns on the cards, the emerald cap with its gold
 * tassel, emerald over gold. The visitor flies Eid al-Fitr's parts (one set
 * of bitmaps); the cards' stills are drawn into this kit's own folder by the
 * same code, because a dressing reads only its own.
 *
 * Art: webapp/scripts/festival-art/eid-al-adha.py, drawn by ./_eid.py
 * (public/festivals/eid-al-adha/).
 */

import { eidKit } from "./eid-al-fitr";

// The cap under a name of its own: an outfit item belongs to one festival.
export default eidKit("eid-al-adha", "eid_cap_adha");
