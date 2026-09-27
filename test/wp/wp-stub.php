<?php
// WordPress simulado para probar el plugin sin instalar WordPress: implementa solo las funciones que usa.
// Uso: php wp-stub.php <carpeta-del-sitio> <accion: activate|tick|uninstall>
$SITE = rtrim($argv[1], '/');
define('ABSPATH', $SITE . '/');
define('WP_CONTENT_DIR', $SITE . '/wp-content');
define('DB_NAME', 'blog');
define('WP_DEBUG', true);            // con WP_DEBUG_DISPLAY sin definir: muestra errores (hallazgo)
$STORE = $SITE . '/.options.json';
$GLOBALS['opts'] = is_file($STORE) ? json_decode(file_get_contents($STORE), true) : array();
register_shutdown_function(function () use ($STORE) { file_put_contents($STORE, json_encode($GLOBALS['opts'])); });
$GLOBALS['hooks'] = array();
function add_action($h, $cb) { $GLOBALS['hooks'][$h][] = $cb; }
function add_filter($h, $cb) { $GLOBALS['hooks'][$h][] = $cb; }
function do_action($h) { foreach ($GLOBALS['hooks'][$h] ?? array() as $cb) { call_user_func($cb); } }
function apply_filters($h, $v) { return $v; }
function register_activation_hook($f, $cb) { $GLOBALS['activate'] = $cb; }
function register_deactivation_hook($f, $cb) {}
function plugin_basename($f) { return 'atalaya-agent/atalaya-agent.php'; }
function get_option($k, $d = false) { return array_key_exists($k, $GLOBALS['opts']) ? $GLOBALS['opts'][$k] : $d; }
function update_option($k, $v, $a = null) { $GLOBALS['opts'][$k] = $v; return true; }
function delete_option($k) { unset($GLOBALS['opts'][$k]); return true; }
function get_site_option($k, $d = false) { return get_option($k, $d); }
function get_transient($k) { return get_option('_t_' . $k); }
function set_transient($k, $v, $e) { return update_option('_t_' . $k, $v); }
function delete_transient($k) { return delete_option('_t_' . $k); }
function wp_next_scheduled($h) { return get_option('_cron_' . $h); }
function wp_schedule_event($t, $r, $h) { return update_option('_cron_' . $h, $t); }
function wp_clear_scheduled_hook($h) { return delete_option('_cron_' . $h); }
function is_wp_error($x) { return $x instanceof WP_Error; }
class WP_Error { public $m; function __construct($m) { $this->m = $m; } function get_error_message() { return $this->m; } }
function wp_remote_post($url, $a) {
  $h = array(); foreach ($a['headers'] as $k => $v) { $h[] = "$k: $v"; }
  $c = curl_init($url); curl_setopt_array($c, array(CURLOPT_POST => 1, CURLOPT_POSTFIELDS => $a['body'], CURLOPT_HTTPHEADER => $h, CURLOPT_RETURNTRANSFER => 1, CURLOPT_TIMEOUT => $a['timeout']));
  $b = curl_exec($c); if ($b === false) { return new WP_Error(curl_error($c)); }
  return array('code' => curl_getinfo($c, CURLINFO_HTTP_CODE), 'body' => $b);
}
function wp_remote_retrieve_body($r) { return $r['body']; }
function wp_remote_retrieve_response_code($r) { return $r['code']; }
function wp_json_encode($v) { return json_encode($v); }
function untrailingslashit($s) { return rtrim($s, '/\\'); }
function esc_url_raw($s) { return $s; }
function wp_parse_url($u, $c = -1) { return parse_url($u, $c); }
function home_url() { return 'https://blog-ana.com'; }
function site_url($p = '') { return 'https://blog-ana.com/' . $p; }
function get_bloginfo($k) { return $k === 'version' ? '6.5.2' : 'Blog de Ana'; }
function get_site_transient($k) {
  if ($k === 'update_core') { return (object) array('updates' => array((object) array('response' => 'upgrade', 'current' => '6.8.1'))); }
  if ($k === 'update_plugins') { return (object) array('response' => array('akismet/akismet.php' => (object) array('new_version' => '5.4'))); }
  if ($k === 'update_themes') { return (object) array('response' => array()); }
  return false;
}
function get_plugins() { return array('akismet/akismet.php' => array('Name' => 'Akismet', 'Version' => '5.1'), 'hello.php' => array('Name' => 'Hello Dolly', 'Version' => '1.7'),
  'woocommerce/woocommerce.php' => array('Name' => 'WooCommerce', 'Version' => '9.0')); }
function is_multisite() { return false; }
function is_plugin_active_for_network($f) { return false; }
function wp_strip_all_tags($s) { return strip_tags($s); }
function get_stylesheet() { return 'astra'; }
function get_template() { return 'astra'; }
class T { public $d; function __construct($d) { $this->d = $d; } function get($k) { return $this->d[$k]; } }
function wp_get_themes() { return array('astra' => new T(array('Name' => 'Astra', 'Version' => '4.6')), 'twentytwenty' => new T(array('Name' => 'Twenty Twenty', 'Version' => '2.0')), 'twentyone' => new T(array('Name' => 'Twenty One', 'Version' => '1.0'))); }
function _get_cron_array() { return array(time() - 3600 => array('a' => 1, 'b' => 1, 'c' => 1), time() - 7200 => array('d' => 1, 'e' => 1, 'f' => 1)); }
function count_users() { return array('total_users' => 12, 'avail_roles' => array('administrator' => 2)); }
function username_exists($u) { return $u === 'admin' ? 1 : false; }
function gethostname_stub() { return 'srv'; }
class WPDB { public $prefix = 'wp_'; public $options = 'wp_options';
  function prepare($q, ...$a) { return $q; } function esc_like($s) { return $s; } function db_version() { return '10.6.18'; }
  function get_var($q) { return strpos($q, 'information_schema') !== false ? 52428800 : 2097152; } }
$GLOBALS['wpdb'] = new WPDB();
update_option('active_plugins', array('akismet/akismet.php', 'woocommerce/woocommerce.php'));
update_option('users_can_register', 1); update_option('default_role', 'administrator');
require WP_CONTENT_DIR . '/plugins/atalaya-agent/atalaya-agent.php';
do_action('plugins_loaded');
$act = $argv[2];
if ($act === 'activate') { call_user_func($GLOBALS['activate']); }
if ($act === 'tick') { do_action('atalaya_agent_tick'); }
if ($act === 'uninstall') { define('WP_UNINSTALL_PLUGIN', 1); require WP_CONTENT_DIR . '/plugins/atalaya-agent/uninstall.php'; }
$o = get_option('atalaya_agent');
echo json_encode(array('paired' => !empty($o['cred']), 'last_push' => $o['last_push'] ?? null, 'error' => $o['last_error'] ?? null, 'want' => $o['want'] ?? null)), "\n";
