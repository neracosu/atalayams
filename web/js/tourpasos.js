// Visita guiada: los pasos. Solo datos; el motor es tour.js.
//
// Cada paso:
//   en       que senala. { dom: '[data-tour="..."]' } un elemento de la interfaz; { mundo: 'tower' | 'proyecto' |
//            'agente' | 'gate' | 'jail' } algo del mapa (lo ubica el tema con screenOf); sin `en`, tarjeta al centro.
//   compacto en telefonos y tablets los paneles son hojas: ahi se senala esto en vez de `en`.
//   titulo   una frase, no una etiqueta.
//   texto    dos o tres lineas. Admite <b>. De usted, y diciendo que gana la persona.
//   nota     opcional: lo que tranquiliza o avisa.
//   solo     opcional: { ediciones: ['vps', ...], rol: 'owner', modo: 'compacto' | 'amplio' }. Fuera de eso se salta.
//
// Reglas:
//  - Un paso cuyo elemento no esta en pantalla se salta en silencio: por eso se puede senalar algo que depende de
//    los datos (un proyecto, un agente).
//  - Ningun texto nombra un proyecto, un dominio ni una persona: la visita se ve igual en modo publico.
//  - Al agregar algo nuevo a la interfaz, su ancla y su paso van en el mismo cambio.
//  - Si el recorrido cambia de arriba abajo, suba VERSION: se le vuelve a ofrecer a quien ya la vio.

export const VERSION = 1;

export const PASOS = [
  // ------------------------------------------------------------------ apertura
  {
    id: 'bienvenida',
    titulo: 'Bienvenido a Atalaya',
    texto: 'Todo lo que usted tiene en línea, visto como un lugar vivo. <b>Cada proyecto es una construcción</b>, cada visita es algo que llega, y lo que falla se nota desde lejos.',
    nota: 'La visita dura un minuto. Puede salir cuando quiera y repetirla desde el menú.',
  },

  // ------------------------------------------------------------------ el mapa
  {
    id: 'torre', en: { mundo: 'tower' },
    titulo: 'El centro de todo',
    texto: 'Desde aquí se vigila lo demás. <b>Tóquelo</b> y verá el resumen: qué está bien, qué pide atención y qué conviene revisar.',
  },
  {
    id: 'proyecto', en: { mundo: 'proyecto' },
    titulo: 'Cada construcción es uno de sus proyectos',
    texto: 'Su luz dice cómo está: <b>verde</b> en línea, <b>ámbar</b> a medias, <b>roja</b> caído. Tóquelo y se abre su ficha, con las visitas, los errores y lo que le pasó últimamente.',
    nota: 'Lo que se mueve hacia él son visitas que están llegando ahora.',
  },
  {
    id: 'agente', en: { mundo: 'agente' },
    titulo: 'Este es un agente de Claude Code trabajando',
    texto: 'Camina hacia lo que está haciendo: leer, editar, correr un comando. Si se detiene con un aviso ámbar, <b>lo está esperando a usted</b>.',
  },

  // ------------------------------------------------------------------ la interfaz
  {
    id: 'cifras', en: { dom: '[data-tour="cifras"]' },
    titulo: 'Los números de este momento',
    texto: 'Lo que está pasando ahora, de un vistazo. <b>Toque cualquiera</b> para ver su historia de las últimas horas.',
  },
  {
    id: 'agentes', en: { dom: '[data-tour="agentes"]' }, compacto: { dom: '#tabs [data-sheet="left"]' },
    titulo: 'Quién está trabajando',
    texto: 'Cada sesión de Claude Code, con lo que hace y hace cuánto. La que <b>pide permiso o tiene una pregunta</b> sube al principio.',
  },
  {
    id: 'paneles', en: { dom: '[data-tour="paneles"]' }, compacto: { dom: '#tabs [data-sheet="right"]' },
    titulo: 'Las gráficas y los resúmenes',
    texto: 'El tráfico, sus proyectos y el estado general. Cada recuadro <b>se abre</b> con el detalle completo.',
  },
  {
    id: 'cinta', en: { dom: '[data-tour="cinta"]' }, compacto: { dom: '#tabs [data-sheet="ticker"]' },
    titulo: 'Lo que va pasando, en orden',
    texto: 'Cada novedad pasa por aquí: un despliegue, una caída, un acceso. Con <b>Ver todo</b> tiene el historial y sus filtros.',
  },
  {
    id: 'modo', en: { dom: '[data-tour="modo"]' },
    titulo: 'Público para mostrar, privado para trabajar',
    texto: 'En <b>público</b> no sale ningún nombre, dominio, ruta ni IP: puede dejarla en una TV. En <b>privado</b>, con su PIN, ve todo el detalle por el tiempo que elija.',
    nota: 'Vuelve sola a público cuando se cumple el tiempo.',
  },
  {
    id: 'mapa', en: { dom: '[data-tour="mapa"]' },
    titulo: 'Para moverse por el mapa',
    texto: 'Acerque, aleje o vuelva a verlo entero. El signo <b>?</b> abre la leyenda: qué significa cada color, cada ícono y cada cosa que se mueve.',
    nota: 'También puede arrastrar el mapa y usar la rueda del mouse.',
  },
  {
    id: 'menu-dueno', en: { dom: '[data-tour="menu"]' }, solo: { rol: 'owner' },
    titulo: 'Aquí se conecta y se configura',
    texto: 'Sus proyectos, las <b>alertas</b> por Telegram y correo, los usuarios y el tema de la pantalla. Es lo que se toca una vez y casi no se vuelve a tocar.',
  },
  {
    id: 'menu-visor', en: { dom: '[data-tour="menu"]' }, solo: { rol: 'viewer' },
    titulo: 'El menú de la pantalla',
    texto: 'Cambie el <b>tema</b>, póngala en pantalla completa o deje que la cámara siga sola lo que pasa.',
  },

  // ------------------------------------------------------------------ cierre
  {
    id: 'cierre',
    titulo: 'Eso es todo. Su día a día son tres cosas',
    texto: '<b>1.</b> Mire el mapa: lo rojo pide atención. <b>2.</b> Toque lo que le llame la atención y lea su ficha. <b>3.</b> Active las alertas, para enterarse aunque no esté mirando.',
    nota: 'Puede repetir esta visita cuando quiera: con la tecla <b>V</b>, arriba junto al nombre, desde el menú o desde la leyenda.',
  },
];
