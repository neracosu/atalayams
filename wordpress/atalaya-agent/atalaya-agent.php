<?php
/**
 * Plugin Name:       Atalaya Monitor Server · Agente
 * Plugin URI:        https://neracosu.com/atalaya/
 * Description:       Envía a su pantalla de Atalaya el estado de este WordPress: versiones, actualizaciones pendientes, seguridad básica, errores y visitas. Solo lee y envía: no agrega rutas públicas ni cambia nada del sitio.
 * Version:           1.1.0
 * Requires at least: 5.6
 * Requires PHP:      7.4
 * Author:            NERACOSU
 * Author URI:        https://neracosu.com
 * License:           Propietaria
 * Text Domain:       atalaya-agent
 */

// Seguridad del plugin (a proposito, muy poco codigo):
//  - no registra rutas REST, ni admin-ajax sin sesion, ni shortcodes: no suma nada que se pueda atacar desde afuera
//  - solo el administrador (manage_options) ve y usa su pagina; todos los formularios llevan nonce
//  - envia hacia afuera con wp_remote_post (TLS verificado); el token vive en una opcion sin autoload
//  - nunca envia contrasenas ni valores de wp-config.php: solo si ciertas opciones estan activas o no
//  - todo corre dentro de try/catch: si algo falla, el sitio sigue igual

if (!defined('ABSPATH')) { exit; }

define('ATALAYA_AGENT_VERSION', '1.1.0');
define('ATALAYA_AGENT_PROTOCOL', 1);

final class Atalaya_Agent {
	const OPT = 'atalaya_agent';
	const HOOK = 'atalaya_agent_tick';

	public static function boot() {
		add_filter('cron_schedules', array(__CLASS__, 'schedules'));
		add_action(self::HOOK, array(__CLASS__, 'tick'));
		add_action('admin_menu', array(__CLASS__, 'menu'));
		add_action('admin_post_atalaya_agent_pair', array(__CLASS__, 'handle_pair'));
		add_action('admin_post_atalaya_agent_disconnect', array(__CLASS__, 'handle_disconnect'));
		add_action('admin_post_atalaya_agent_now', array(__CLASS__, 'handle_now'));
		add_action('wp_dashboard_setup', array(__CLASS__, 'dashboard'));
		add_filter('plugin_action_links_' . plugin_basename(__FILE__), array(__CLASS__, 'links'));
		// si alguien borro el evento (o el sitio se migro), se vuelve a programar
		if (self::paired() && !wp_next_scheduled(self::HOOK)) { wp_schedule_event(time() + 60, 'atalaya_minute', self::HOOK); }
	}

	// ------------------------------------------------------------------ estado
	public static function opt() {
		$o = get_option(self::OPT, array());
		return is_array($o) ? $o : array();
	}
	public static function save($o) { update_option(self::OPT, $o, false); }
	public static function paired() { $o = self::opt(); return !empty($o['url']) && !empty($o['cred']); }

	public static function schedules($s) {
		$s['atalaya_minute'] = array('interval' => 60, 'display' => 'Cada minuto (Atalaya)');
		return $s;
	}

	// ------------------------------------------------------------------ activacion
	public static function activate() {
		// zip personalizado desde Atalaya: trae la direccion y un codigo de un solo uso
		$f = __DIR__ . '/atalaya-config.php';
		if (!self::paired() && is_readable($f)) {
			$c = include $f;
			// el codigo ya no sirve despues del canje: el archivo se borra (si la carpeta lo permite)
			if (is_array($c) && !empty($c['url']) && !empty($c['code'])) {
				$r = self::pair($c['url'], $c['code']);
				if ($r === true) { @unlink($f); }
				else { update_option('atalaya_agent_pair_error', $r, false); } // se muestra en Ajustes › Atalaya
			}
		}
		if (self::paired() && !wp_next_scheduled(self::HOOK)) { wp_schedule_event(time() + 5, 'atalaya_minute', self::HOOK); }
	}
	public static function deactivate() { wp_clear_scheduled_hook(self::HOOK); }

	// canje del codigo por el token del agente
	public static function pair($url, $code) {
		$url = untrailingslashit(esc_url_raw(trim($url)));
		$code = strtoupper(preg_replace('/[^A-Za-z0-9-]/', '', (string) $code));
		if (!preg_match('#^https://#i', $url) && !preg_match('#^http://(127\.0\.0\.1|localhost)(:\d+)?$#', $url)) { return 'La dirección de Atalaya debe empezar con https://'; }
		if ($code === '') { return 'Falta el código de vinculación.'; }
		$host = wp_parse_url(home_url(), PHP_URL_HOST);
		$r = wp_remote_post($url . '/api/agent/pair', array(
			'timeout' => 20,
			'headers' => array('Content-Type' => 'application/json'),
			'body' => wp_json_encode(array('code' => $code, 'user' => $host, 'host' => (string) gethostname(), 'kind' => 'wordpress')),
		));
		if (is_wp_error($r)) { return 'No se pudo conectar con Atalaya: ' . $r->get_error_message(); }
		$body = trim(wp_remote_retrieve_body($r));
		if (wp_remote_retrieve_response_code($r) !== 200 || strpos($body, ':') === false) { return 'El código venció o ya se usó. Genere uno nuevo en Atalaya.'; }
		self::save(array('url' => $url, 'cred' => $body, 'paired_at' => time(), 'want' => array('full')));
		delete_option('atalaya_agent_pair_error');
		$f = __DIR__ . '/atalaya-config.php'; if (is_file($f)) { @unlink($f); }
		if (!wp_next_scheduled(self::HOOK)) { wp_schedule_event(time() + 5, 'atalaya_minute', self::HOOK); }
		return true;
	}

	// ------------------------------------------------------------------ envio (WP-Cron, cada minuto)
	public static function tick() {
		if (!self::paired()) { return; }
		// una ejecucion a la vez
		if (get_transient('atalaya_agent_lock')) { return; }
		set_transient('atalaya_agent_lock', 1, 120);
		try { self::send(); }
		catch (\Throwable $e) { $o = self::opt(); $o['last_error'] = substr($e->getMessage(), 0, 200); self::save($o); }
		delete_transient('atalaya_agent_lock');
	}

	public static function send() {
		$o = self::opt();
		$now = time();
		$want = isset($o['want']) && is_array($o['want']) ? $o['want'] : array();
		$full = in_array('full', $want, true) || empty($o['full_at']) || $now - (int) $o['full_at'] >= 600;
		$offsets = isset($o['offsets']) && is_array($o['offsets']) ? $o['offsets'] : array();
		$newOff = array();
		$out = '';
		$sec = function ($name, $body) use (&$out) { $out .= "\n@@" . $name . "\n" . $body; };
		$home = self::home();
		$host = (string) wp_parse_url(home_url(), PHP_URL_HOST);

		$sec('meta', implode("\n", array(
			'v=' . ATALAYA_AGENT_PROTOCOL, 'kind=wordpress', 'plugin=' . ATALAYA_AGENT_VERSION, 'user=' . $host,
			'host=' . gethostname(), 'now=' . $now, 'full=' . ($full ? 1 : 0), 'php=' . PHP_VERSION, 'wp=' . get_bloginfo('version'),
		)) . "\n");

		// visitas: los logs de la cuenta si PHP puede leerlos (cPanel: ~/access-logs)
		if ($home && @is_dir($home . '/access-logs') && @is_readable($home . '/access-logs')) {
			foreach (array($host, $host . '-ssl_log', 'www.' . $host, 'www.' . $host . '-ssl_log') as $n) {
				$f = $home . '/access-logs/' . $n;
				if (!@is_file($f) || !@is_readable($f)) { continue; }
				$chunk = self::tailnew($f, $offsets, $newOff, 1048576, 0);
				if ($chunk !== '') { $sec('access ' . preg_replace('/-ssl_log$/', '', $n), $chunk); }
			}
		}
		// errores: debug.log de WordPress y el error_log de PHP de la carpeta del sitio
		foreach (array_unique(array_filter(array(WP_CONTENT_DIR . '/debug.log', ABSPATH . 'error_log', self::php_error_log()))) as $f) {
			if (!@is_file($f) || !@is_readable($f)) { continue; }
			$chunk = self::tailnew($f, $offsets, $newOff, 16384, 4096);
			$sec('errlog ' . (int) @filesize($f) . ' ' . (int) @filemtime($f) . ' ' . $f, $chunk);
		}

		if ($full) {
			$wp = self::collect();
			$sec('wp', wp_json_encode($wp) . "\n");
			$sec('domains', $host . "\t" . untrailingslashit(ABSPATH) . "\n");
			$sec('docroots', untrailingslashit(ABSPATH) . "\twordpress\t" . get_bloginfo('version') . "\n");
		}
		if (in_array('du', $want, true)) { $sec('du', self::du()); }

		$gz = function_exists('gzencode') ? gzencode($out, 6) : false;
		$r = wp_remote_post($o['url'] . '/api/agent/push', array(
			'timeout' => 30,
			'headers' => array_merge(array('X-Atalaya-Agent' => $o['cred'], 'Content-Type' => 'application/octet-stream'), $gz !== false ? array('Content-Encoding' => 'gzip') : array()),
			'body' => $gz !== false ? $gz : $out,
		));
		$o = self::opt();
		if (is_wp_error($r)) { $o['last_error'] = $r->get_error_message(); self::save($o); return; }
		$code = wp_remote_retrieve_response_code($r);
		$body = trim(wp_remote_retrieve_body($r));
		if ($code === 401) { $o['last_error'] = 'Atalaya rechazó el token: este sitio fue quitado. Vuelva a conectarlo con un código nuevo.'; self::save($o); return; }
		if ($code !== 200 || strpos($body, 'ok') !== 0) { $o['last_error'] = 'Atalaya respondió ' . $code; self::save($o); return; }
		// envio aceptado: posiciones de lectura y pedidos de Atalaya (solo palabras de una lista cerrada)
		$o['offsets'] = array_merge($offsets, $newOff);
		$o['last_push'] = $now; $o['last_error'] = '';
		if ($full) { $o['full_at'] = $now; }
		$o['want'] = array_values(array_intersect(preg_split('/\s+/', $body), array('full', 'du')));
		self::save($o);
	}

	// lineas nuevas de un archivo desde el ultimo envio
	private static function tailnew($f, $offsets, &$newOff, $cap, $first) {
		$key = md5($f);
		$size = (int) @filesize($f);
		$off = isset($offsets[$key]) ? (int) $offsets[$key] : max(0, $size - $first);
		if ($size < $off) { $off = 0; } // se roto o se vacio
		$newOff[$key] = $size;
		if ($size <= $off) { return ''; }
		if ($size - $off > $cap) { $off = $size - $cap; }
		$h = @fopen($f, 'rb');
		if (!$h) { return ''; }
		fseek($h, $off);
		$d = (string) fread($h, $cap);
		fclose($h);
		return $d;
	}

	private static function home() {
		$h = getenv('HOME');
		if ($h && @is_dir($h)) { return rtrim($h, '/'); }
		if (preg_match('#^(/home\d*/[^/]+)/#', ABSPATH, $m)) { return $m[1]; }
		return '';
	}
	private static function php_error_log() {
		$f = (string) ini_get('error_log');
		return ($f !== '' && $f[0] === '/' && strpos($f, 'syslog') === false) ? $f : '';
	}

	// ------------------------------------------------------------------ lo que se sabe desde adentro de WordPress
	public static function collect() {
		global $wpdb;
		if (!function_exists('get_plugins')) { require_once ABSPATH . 'wp-admin/includes/plugin.php'; }
		$wp_version = get_bloginfo('version');
		$core = get_site_transient('update_core');
		$core_update = '';
		if ($core && !empty($core->updates)) {
			foreach ($core->updates as $u) {
				if (isset($u->response) && $u->response === 'upgrade' && version_compare($u->current, $wp_version, '>')) { $core_update = $u->current; break; }
			}
		}
		$up = get_site_transient('update_plugins');
		$active = (array) get_option('active_plugins', array());
		$auto = (array) get_site_option('auto_update_plugins', array());
		$plugins = array();
		foreach (get_plugins() as $file => $p) {
			$plugins[] = array(
				'slug' => dirname($file) === '.' ? basename($file, '.php') : dirname($file), 'name' => wp_strip_all_tags($p['Name']), 'version' => $p['Version'],
				'active' => in_array($file, $active, true) || (is_multisite() && is_plugin_active_for_network($file)),
				'update' => ($up && isset($up->response[$file]->new_version)) ? $up->response[$file]->new_version : '',
				'auto' => in_array($file, $auto, true),
			);
			if (count($plugins) >= 150) { break; }
		}
		$upt = get_site_transient('update_themes');
		$current = get_stylesheet();
		$parent = get_template();
		$themes = array();
		foreach (wp_get_themes() as $slug => $t) {
			$themes[] = array('slug' => $slug, 'name' => $t->get('Name'), 'version' => $t->get('Version'), 'active' => $slug === $current || $slug === $parent,
				'update' => ($upt && isset($upt->response[$slug]['new_version'])) ? $upt->response[$slug]['new_version'] : '');
			if (count($themes) >= 50) { break; }
		}
		// base de datos: tamano de las tablas del sitio y peso de las opciones que se cargan en cada visita (solo SELECT)
		$db_size = (int) $wpdb->get_var($wpdb->prepare('SELECT SUM(data_length + index_length) FROM information_schema.TABLES WHERE table_schema = %s AND table_name LIKE %s', DB_NAME, $wpdb->esc_like($wpdb->prefix) . '%'));
		$autoload = (int) $wpdb->get_var("SELECT SUM(LENGTH(option_value)) FROM {$wpdb->options} WHERE autoload IN ('yes','on','auto-on','auto')");
		$crons = function_exists('_get_cron_array') ? (array) _get_cron_array() : array();
		$late = 0;
		foreach ($crons as $ts => $x) { if ($ts < time() - 600) { $late += count((array) $x); } }
		$users = count_users();
		$debug = defined('WP_DEBUG') && WP_DEBUG;
		return array(
			'version' => $wp_version, 'coreUpdate' => $core_update, 'multisite' => is_multisite(),
			'php' => PHP_VERSION, 'db' => $wpdb->db_version(), 'dbSize' => $db_size, 'autoload' => $autoload,
			'home' => home_url(), 'name' => wp_strip_all_tags(get_bloginfo('name')), 'https' => strpos(home_url(), 'https://') === 0,
			'plugins' => $plugins, 'themes' => $themes,
			'debug' => $debug, 'debugDisplay' => $debug && (!defined('WP_DEBUG_DISPLAY') || WP_DEBUG_DISPLAY) && ini_get('display_errors') !== '0',
			'debugLogPublic' => @is_file(WP_CONTENT_DIR . '/debug.log') && strpos(WP_CONTENT_DIR, untrailingslashit(ABSPATH)) === 0,
			'fileEdit' => !(defined('DISALLOW_FILE_EDIT') && DISALLOW_FILE_EDIT) && !(defined('DISALLOW_FILE_MODS') && DISALLOW_FILE_MODS),
			'adminUser' => (bool) username_exists('admin'), 'admins' => isset($users['avail_roles']['administrator']) ? (int) $users['avail_roles']['administrator'] : 0,
			'users' => isset($users['total_users']) ? (int) $users['total_users'] : 0,
			'registration' => (bool) get_option('users_can_register'), 'defaultRole' => (string) get_option('default_role'),
			'xmlrpc' => (bool) apply_filters('xmlrpc_enabled', true), 'cronDisabled' => defined('DISABLE_WP_CRON') && DISABLE_WP_CRON, 'cronLate' => $late,
			'autoCore' => defined('WP_AUTO_UPDATE_CORE') ? (string) WP_AUTO_UPDATE_CORE : 'minor', 'woocommerce' => defined('WC_VERSION') ? WC_VERSION : '',
		);
	}

	// que carpetas de wp-content ocupan mas (a pedido; tope de archivos para no cargar el sitio)
	private static function du() {
		$root = WP_CONTENT_DIR;
		$sizes = array();
		$n = 0;
		try {
			$it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::LEAVES_ONLY, RecursiveIteratorIterator::CATCH_GET_CHILD);
			foreach ($it as $f) {
				if (++$n > 200000) { break; }
				if (!$f->isFile()) { continue; }
				$rel = substr($f->getPathname(), strlen($root) + 1);
				$parts = explode('/', $rel);
				$s = $f->getSize();
				$acc = $root;
				foreach (array_slice($parts, 0, min(3, count($parts) - 1)) as $p) { $acc .= '/' . $p; $sizes[$acc] = (isset($sizes[$acc]) ? $sizes[$acc] : 0) + $s; }
				$sizes[$root] = (isset($sizes[$root]) ? $sizes[$root] : 0) + $s;
			}
		} catch (\Throwable $e) { /* sin permiso en alguna carpeta */ }
		arsort($sizes);
		$out = '';
		foreach (array_slice($sizes, 0, 300, true) as $p => $s) { $out .= (int) ceil($s / 1024) . "\t" . $p . "\n"; }
		return $out;
	}

	// ------------------------------------------------------------------ administracion (solo administradores)
	public static function menu() { add_options_page('Atalaya', 'Atalaya', 'manage_options', 'atalaya-agent', array(__CLASS__, 'page')); }
	public static function links($l) { array_unshift($l, '<a href="' . esc_url(admin_url('options-general.php?page=atalaya-agent')) . '">Ajustes</a>'); return $l; }

	public static function page() {
		if (!current_user_can('manage_options')) { return; }
		$o = self::opt();
		$msg = isset($_GET['atalaya']) ? sanitize_text_field(wp_unslash($_GET['atalaya'])) : '';
		echo '<div class="wrap"><h1>Atalaya Monitor Server · Agente</h1>';
		if ($msg !== '') { echo '<div class="notice notice-info"><p>' . esc_html($msg) . '</p></div>'; }
		echo '<p>Este plugin envía a su pantalla de Atalaya el estado de este WordPress: versiones, actualizaciones pendientes, seguridad básica, errores y visitas. <b>Solo lee y envía</b>: no agrega rutas públicas ni cambia nada del sitio.</p>';
		if (self::paired()) {
			$last = !empty($o['last_push']) ? human_time_diff((int) $o['last_push']) : '';
			echo '<table class="form-table"><tr><th>Conectado a</th><td><code>' . esc_html($o['url']) . '</code></td></tr>';
			echo '<tr><th>Último envío</th><td>' . ($last !== '' ? 'hace ' . esc_html($last) : 'todavía ninguno') . '</td></tr>';
			if (!empty($o['last_error'])) { echo '<tr><th>Último error</th><td style="color:#b32d2e">' . esc_html($o['last_error']) . '</td></tr>'; }
			if (defined('DISABLE_WP_CRON') && DISABLE_WP_CRON) { echo '<tr><th>WP-Cron</th><td>Desactivado (DISABLE_WP_CRON): asegúrese de tener una tarea cron real que llame a <code>wp-cron.php</code> cada minuto.</td></tr>'; }
			echo '</table>';
			echo '<p class="description">WP-Cron corre cuando el sitio recibe visitas. En sitios con poco tráfico, una tarea cron del hosting que abra <code>' . esc_html(site_url('wp-cron.php')) . '</code> cada minuto hace que los envíos sean puntuales.</p>';
			echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '" style="display:inline-block;margin-right:8px">';
			wp_nonce_field('atalaya_agent_now'); echo '<input type="hidden" name="action" value="atalaya_agent_now">'; submit_button('Enviar ahora', 'primary', 'submit', false); echo '</form>';
			echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '" style="display:inline-block">';
			wp_nonce_field('atalaya_agent_disconnect'); echo '<input type="hidden" name="action" value="atalaya_agent_disconnect">'; submit_button('Desconectar', 'secondary', 'submit', false); echo '</form>';
		} else {
			// lo que trae el .zip (la direccion, y el codigo si se descargo ya configurado) y por que no se conecto solo
			$pre = array('url' => '', 'code' => '');
			$cf = __DIR__ . '/atalaya-config.php';
			if (is_readable($cf)) { $c = include $cf; if (is_array($c)) { $pre = array_merge($pre, array_intersect_key($c, $pre)); } }
			$perr = (string) get_option('atalaya_agent_pair_error', '');
			if ($perr !== '') { echo '<div class="notice notice-error"><p>No se pudo conectar solo al activarse: ' . esc_html($perr) . '</p></div>'; }
			echo '<h2>Conectar con Atalaya</h2><p>Para el código: en su Atalaya abra el menú › <b>Conectar un hosting compartido</b>, y en el recuadro <b>Conectar un sitio WordPress</b> escriba un nombre para este sitio y pulse <b>Ya lo tengo instalado: ver código</b>. Copie aquí la dirección y el código (vale 24 horas y sirve una sola vez).</p>';
			echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
			wp_nonce_field('atalaya_agent_pair');
			echo '<input type="hidden" name="action" value="atalaya_agent_pair"><table class="form-table">';
			echo '<tr><th><label for="atalaya_url">Dirección de Atalaya</label></th><td><input class="regular-text" type="url" id="atalaya_url" name="url" placeholder="https://atalaya.su-dominio.com" value="' . esc_attr($pre['url']) . '" required></td></tr>';
			echo '<tr><th><label for="atalaya_code">Código</label></th><td><input class="regular-text" type="text" id="atalaya_code" name="code" placeholder="XXXX-XXXX-XXXX-XXXX" value="' . esc_attr($pre['code']) . '" autocomplete="off" required></td></tr>';
			echo '</table>'; submit_button('Conectar'); echo '</form>';
		}
		echo '</div>';
	}

	private static function back($msg) { wp_safe_redirect(add_query_arg('atalaya', rawurlencode($msg), admin_url('options-general.php?page=atalaya-agent'))); exit; }

	public static function handle_pair() {
		if (!current_user_can('manage_options')) { wp_die('Sin permiso'); }
		check_admin_referer('atalaya_agent_pair');
		$r = self::pair(isset($_POST['url']) ? wp_unslash($_POST['url']) : '', isset($_POST['code']) ? wp_unslash($_POST['code']) : '');
		if ($r === true) { self::tick(); self::back('Listo: este sitio ya envía su estado a Atalaya.'); }
		self::back($r);
	}
	public static function handle_disconnect() {
		if (!current_user_can('manage_options')) { wp_die('Sin permiso'); }
		check_admin_referer('atalaya_agent_disconnect');
		wp_clear_scheduled_hook(self::HOOK);
		delete_option(self::OPT);
		self::back('Desconectado. Si ya no lo usará, también puede quitar este sitio desde Atalaya.');
	}
	public static function handle_now() {
		if (!current_user_can('manage_options')) { wp_die('Sin permiso'); }
		check_admin_referer('atalaya_agent_now');
		$o = self::opt(); $o['want'] = array('full'); self::save($o);
		delete_transient('atalaya_agent_lock');
		self::tick();
		$o = self::opt();
		self::back(!empty($o['last_error']) ? 'No se pudo enviar: ' . $o['last_error'] : 'Enviado.');
	}

	public static function dashboard() {
		if (!current_user_can('manage_options')) { return; }
		wp_add_dashboard_widget('atalaya_agent', 'Atalaya', function () {
			$o = Atalaya_Agent::opt();
			if (!Atalaya_Agent::paired()) { echo '<p>Sin conectar. <a href="' . esc_url(admin_url('options-general.php?page=atalaya-agent')) . '">Conectar con Atalaya</a></p>'; return; }
			$ok = !empty($o['last_push']) && time() - (int) $o['last_push'] < 600 && empty($o['last_error']);
			echo '<p>' . '<span style="display:inline-block;width:8px;height:8px;margin-right:6px;background:' . ($ok ? '#16a34a' : '#d97706') . '"></span>' . ($ok ? 'Enviando su estado a Atalaya' : 'Sin envíos recientes') . (!empty($o['last_push']) ? ' · último hace ' . esc_html(human_time_diff((int) $o['last_push'])) : '') . '</p>';
			echo '<p><a class="button" href="' . esc_url($o['url']) . '" target="_blank" rel="noopener noreferrer">Abrir Atalaya</a></p>';
		});
	}
}

register_activation_hook(__FILE__, array('Atalaya_Agent', 'activate'));
register_deactivation_hook(__FILE__, array('Atalaya_Agent', 'deactivate'));
add_action('plugins_loaded', array('Atalaya_Agent', 'boot'));
