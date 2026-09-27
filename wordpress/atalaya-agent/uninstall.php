<?php
// Al borrar el plugin: se quitan su opcion, su candado y su evento programado. No deja nada.
if (!defined('WP_UNINSTALL_PLUGIN')) { exit; }
wp_clear_scheduled_hook('atalaya_agent_tick');
delete_option('atalaya_agent');
delete_option('atalaya_agent_pair_error');
delete_transient('atalaya_agent_lock');
