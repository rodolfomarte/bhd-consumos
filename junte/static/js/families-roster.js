/* ════════════════════════════════════════════════════════════════════════
   Roster de villas y familias — fuente única de verdad.
   Usado por main.js (Mural), live.js (Live) y cuenta.js (registro), para que
   el nombre de familia elegido al registrarse siempre calce con las filas
   del Mural y las opciones del feed Live.
   ════════════════════════════════════════════════════════════════════════ */
const FAMILIES_ROSTER = [
  { name:"Villa Palmera", icon:"🌴",
    familias:[
      { nombre:"Miguel De la Cruz",  hab:"" },
      { nombre:"Margarita Félix",    hab:"" },
      { nombre:"Selia Peralta",      hab:"" },
      { nombre:"Jhon Daniel",        hab:"" },
      { nombre:"Adolfo Pérez",       hab:"" },
    ]},
  { name:"Villa Pérez", icon:"🌿",
    familias:[
      { nombre:"Mariel Pérez",       hab:"" },
      { nombre:"Orlando Tejeda",     hab:"" },
      { nombre:"Haronid Rodríguez",  hab:"" },
      { nombre:"Joel Abad",          hab:"" },
      { nombre:"Johelmi Abad",       hab:"" },
    ]},
  { name:"Villa Café", icon:"☕",
    familias:[
      { nombre:"Bernardo Rodríguez", hab:"" },
      { nombre:"Joel Hereaux",       hab:"" },
      { nombre:"Gabriel Pérez",      hab:"" },
      { nombre:"Manuel Serulle",     hab:"" },
      { nombre:"Martha de la Rosa",  hab:"" },
    ]},
  { name:"Villa Cereza", icon:"🍒",
    familias:[
      { nombre:"Pedro Pangola",      hab:"" },
      { nombre:"Francisco Silverio", hab:"" },
      { nombre:"Maribel Rosario",    hab:"" },
      { nombre:"Reynaldo Pérez",     hab:"" },
    ]},
  { name:"Villa Bosque", icon:"🌲",
    familias:[
      { nombre:"Rodolfo Marte",      hab:"" },
      { nombre:"Vladimir Méndez",    hab:"" },
      { nombre:"Julio Sánchez",      hab:"" },
      { nombre:"Elías Gómez",        hab:"" },
      { nombre:"María García",       hab:"" },
    ]},
];

function getAllFamiliasRoster() {
  return FAMILIES_ROSTER.flatMap(v => v.familias.map(f => ({ nombre: f.nombre, villa: v.name })));
}
