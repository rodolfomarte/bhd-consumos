/* ════════════════════════════════════════════════════════════════════════
   Mirror (server-side) of static/js/families-roster.js — same villa order,
   same family names, so a familia slug always resolves to the same villa
   here as it does in the browser. Used by set-captain.js to verify (not
   just trust the admin UI) that a proposed captain actually belongs to the
   villa they're being assigned to.
   ════════════════════════════════════════════════════════════════════════ */
const FAMILIES_ROSTER = [
  { slug: "palmera", familias: ["Miguel De la Cruz", "Margarita Félix", "Selia Peralta", "Jhon Daniel", "Adolfo Pérez"] },
  { slug: "perez",   familias: ["Mariel Pérez", "Orlando Tejeda", "Haronid Rodríguez", "Joel Abad", "Johelmi Abad"] },
  { slug: "cafe",    familias: ["Bernardo Rodríguez", "Joel Hereaux", "Gabriel Pérez", "Manuel Serulle", "Martha de la Rosa"] },
  { slug: "cereza",  familias: ["Pedro Pangola", "Francisco Silverio", "Maribel Rosario", "Reynaldo Pérez"] },
  { slug: "bosque",  familias: ["Rodolfo Marte", "Vladimir Méndez", "Julio Sánchez", "Elías Gómez", "María García"] },
];

const VILLA_SLUGS = FAMILIES_ROSTER.map(v => v.slug);

function slugify(s) {
  return String(s)
    .trim()
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// familia slug -> villa slug
const FAMILIA_TO_VILLA = {};
FAMILIES_ROSTER.forEach(v => {
  v.familias.forEach(nombre => { FAMILIA_TO_VILLA[slugify(nombre)] = v.slug; });
});

module.exports = { VILLA_SLUGS, FAMILIA_TO_VILLA, slugify };
