window.wp = window.wp || {};

(function( $, wp, pagenow ) {
	wp.updates = {};

	/**
	 * User nonce for ajax calls.
	 *
	 * @since 4.2.0
	 *
	 * @var string
	 */
	wp.updates.ajaxNonce = window._wpUpdatesSettings.ajax_nonce;

	/**
	 * Localized strings.
	 *
	 * @since 4.2.0
	 *
	 * @var object
	 */
	wp.updates.l10n = window._wpUpdatesSettings.l10n;

	/**
	 * Whether filesystem credentials need to be requested from the user.
	 *
	 * @since 4.2.0
	 *
	 * @var bool
	 */
	wp.updates.shouldRequestFilesystemCredentials = null;

	/**
	 * Filesystem credentials to be packaged along with the request.
	 *
	 * @since  4.2.0
	 *
	 * @var object
	 */
	wp.updates.filesystemCredentials = {
		ftp: {
			host: null,
			username: null,
			password: null,
			connectionType: null
		},
		ssh: {
			publicKey: null,
			privateKey: null
		}
	};

	/**
	 * Flag if we're waiting for an update to complete.
	 *
	 * @since 4.2.0
	 *
	 * @var bool
	 */
	wp.updates.updateLock = false;

	/**
	 * * Flag if we've done an update successfully.
	 *
	 * @since 4.2.0
	 *
	 * @var bool
	 */
	wp.updates.updateDoneSuccessfully = false;

	/**
	 * If the user tries to update a plugin while an update is
	 * already happening, it can be placed in this queue to perform later.
	 *
	 * @since 4.2.0
	 *
	 * @var array
	 */
	wp.updates.updateQueue = [];

	/**
	 * Decrement update counts throughout the various menus.
	 *
	 * @since 3.9.0
	 *
	 * @param {string} updateType
	 */
	wp.updates.decrementCount = function( upgradeType ) {
		var count,
		    pluginCount,
		    $adminBarUpdateCount = $( '#wp-admin-bar-updates .ab-label' ),
		    $dashboardNavMenuUpdateCount = $( 'a[href="update-core.php"] .update-plugins' ),
		    $pluginsMenuItem = $( '#menu-plugins' );


		count = $adminBarUpdateCount.text();
		count = parseInt( count, 10 ) - 1;
		if ( count < 0 || isNaN( count ) ) {
			return;
		}
		$( '#wp-admin-bar-updates .ab-item' ).removeAttr( 'title' );
		$adminBarUpdateCount.text( count );


		$dashboardNavMenuUpdateCount.each( function( index, elem ) {
			elem.className = elem.className.replace( /count-\d+/, 'count-' + count );
		} );
		$dashboardNavMenuUpdateCount.removeAttr( 'title' );
		$dashboardNavMenuUpdateCount.find( '.update-count' ).text( count );

		if ( 'plugin' === upgradeType ) {
			pluginCount = $pluginsMenuItem.find( '.plugin-count' ).eq(0).text();
			pluginCount = parseInt( pluginCount, 10 ) - 1;
			if ( pluginCount < 0 || isNaN( pluginCount ) ) {
				return;
			}
			$pluginsMenuItem.find( '.plugin-count' ).text( pluginCount );
			$pluginsMenuItem.find( '.update-plugins' ).each( function( index, elem ) {
				elem.className = elem.className.replace( /count-\d+/, 'count-' + pluginCount );
			} );

			if (pluginCount > 0 ) {
				$( '.subsubsub .upgrade .count' ).text( '(' + pluginCount + ')' );
			} else {
				$( '.subsubsub .upgrade' ).remove();
			}
		}
	};

	/**
	 * Send an Ajax request to the server to update a plugin.
	 *
	 * @since 4.2.0
	 *
	 * @param {string} plugin
	 * @param {string} slug
	 */
	wp.updates.updatePlugin = function( plugin, slug ) {
		var $message;
		if ( 'plugins' === pagenow || 'plugins-network' === pagenow ) {
			$message = $( '[data-slug="' + slug + '"]' ).next().find( '.update-message' );
		} else if ( 'plugin-install' === pagenow ) {
			$message = $( '.plugin-card-' + slug ).find( '.update-now' );
		}

		$message.addClass( 'updating-message' );
		$message.text( wp.updates.l10n.updating );
		wp.a11y.speak( wp.updates.l10n.updatingMsg );

		if ( wp.updates.updateLock ) {
			wp.updates.updateQueue.push( {
				type: 'update-plugin',
				data: {
					plugin: plugin,
					slug: slug
				}
			} );
			return;
		}

		wp.updates.updateLock = true;

		var data = {
			_ajax_nonce:     wp.updates.ajaxNonce,
			plugin:          plugin,
			slug:            slug,
			username:        wp.updates.filesystemCredentials.ftp.username,
			password:        wp.updates.filesystemCredentials.ftp.password,
			hostname:        wp.updates.filesystemCredentials.ftp.hostname,
			connection_type: wp.updates.filesystemCredentials.ftp.connectionType,
			public_key:      wp.updates.filesystemCredentials.ssh.publicKey,
			private_key:     wp.updates.filesystemCredentials.ssh.privateKey
		};

		wp.ajax.post( 'update-plugin', data )
			.done( wp.updates.updateSuccess )
			.fail( wp.updates.updateError );
	};

	/**
	 * On a successful plugin update, update the UI with the result.
	 *
	 * @since 4.2.0
	 *
	 * @param {object} response
	 */
	wp.updates.updateSuccess = function( response ) {
		var $updateMessage;
		if ( 'plugins' === pagenow || 'plugins-network' === pagenow ) {
			var $pluginRow = $( '[data-slug="' + response.slug + '"]' ).first();
			$updateMessage = $pluginRow.next().find( '.update-message' );
			$pluginRow.addClass( 'updated' ).removeClass( 'update' );

			// Update the version number in the row.
			var newText = $pluginRow.find('.plugin-version-author-uri').html().replace( response.oldVersion, response.newVersion );
			$pluginRow.find('.plugin-version-author-uri').html( newText );
		} else if ( 'plugin-install' === pagenow ) {
			$updateMessage = $( '.plugin-card-' + response.slug ).find( '.update-now' );
			$updateMessage.addClass( 'button-disabled' );
		}

		$updateMessage.removeClass( 'updating-message' ).addClass( 'updated-message' );
		$updateMessage.text( wp.updates.l10n.updated );
		wp.a11y.speak( wp.updates.l10n.updatedMsg );

		wp.updates.decrementCount( 'plugin' );

		wp.updates.updateDoneSuccessfully = true;

		/*
		 * The lock can be released since the update was successful,
		 * and any other updates can commence.
		 */
		wp.updates.updateLock = false;
		wp.updates.queueChecker();
	};

	/**
	 * On a plugin update error, update the UI appropriately.
	 *
	 * @since 4.2.0
	 *
	 * @param {object} response
	 */
	wp.updates.updateError = function( response ) {
		var $message;
		wp.updates.updateDoneSuccessfully = false;
		if ( response.errorCode && response.errorCode == 'unable_to_connect_to_filesystem' ) {
			wp.updates.credentialError( response, 'update-plugin' );
			return;
		}
		if ( 'plugins' === pagenow || 'plugins-network' === pagenow ) {
			$message = $( '[data-slug="' + response.slug + '"]' ).next().find( '.update-message' );
		} else if ( 'plugin-install' === pagenow ) {
			$message = $( '.plugin-card-' + response.slug ).find( '.update-now' );
		}
		$message.removeClass( 'updating-message' );
		$message.text( wp.updates.l10n.updateFailed );
		wp.a11y.speak( wp.updates.l10n.updateFailed );

	};

	/**
	 * Show an error message in the request for credentials form.
	 *
	 * @param {string} message
	 * @since 4.2.0
	 */
	wp.updates.showErrorInCredentialsForm = function( message ) {
		var $notificationDialog = $( '.notification-dialog' );

		// Remove any existing error
		$notificationDialog.find( '.error' ).remove();

		$notificationDialog.find( 'h3' ).after( '<div class="error">' + message + '</div>' );
	};

	/**
	 * Events that need to happen when there is a credential error
	 *
	 * @since 4.2.0
	 */
	wp.updates.credentialError = function( response, type ) {
		wp.updates.updateQueue.push( {
			'type': type,
			'data': {
				// Not cool that we're depending on response for this data.
				// This would feel more whole in a view all tied together.
				plugin: response.plugin,
				slug: response.slug
			}
		} );
		wp.updates.showErrorInCredentialsForm( response.error );
		wp.updates.requestFilesystemCredentials();
	};

	/**
	 * If an update job has been placed in the queue, queueChecker pulls it out and runs it.
	 *
	 * @since 4.2.0
	 */
	wp.updates.queueChecker = function() {
		if ( wp.updates.updateLock || wp.updates.updateQueue.length <= 0 ) {
			return;
		}

		var job = wp.updates.updateQueue.shift();

		wp.updates.updatePlugin( job.data.plugin, job.data.slug );
	};


	/**
	 * Request the users filesystem credentials if we don't have them already
	 *
	 * @since 4.2.0
	 */
	wp.updates.requestFilesystemCredentials = function() {
		if ( wp.updates.updateDoneSuccessfully === false ) {
			wp.updates.updateLock = true;
			$( 'body' ).addClass( 'modal-open' );
			$( '#request-filesystem-credentials-dialog' ).show();
		}
	};

	$( document ).ready( function() {
		/*
		 * Check whether a user needs to submit filesystem credentials based on whether
		 * the form was output on the page server-side.
		 *
		 * @see {wp_print_request_filesystem_credentials_modal() in PHP}
		 */
		wp.updates.shouldRequestFilesystemCredentials = ( $( '#request-filesystem-credentials-dialog' ).length <= 0 ) ? false : true;

		// File system credentials form submit noop-er / handler.
		$( '#request-filesystem-credentials-dialog form' ).on( 'submit', function() {
			// Persist the credentials input by the user for the duration of the page load.
			wp.updates.filesystemCredentials.ftp.hostname = $('#hostname').val();
			wp.updates.filesystemCredentials.ftp.username = $('#username').val();
			wp.updates.filesystemCredentials.ftp.password = $('#password').val();
			wp.updates.filesystemCredentials.ftp.connectionType = $('input[name="connection_type"]:checked').val();
			wp.updates.filesystemCredentials.ssh.publicKey = $('#public_key').val();
			wp.updates.filesystemCredentials.ssh.privateKey = $('#private_key').val();

			$( '#request-filesystem-credentials-dialog' ).hide();
			$( 'body' ).removeClass( 'modal-open' );

			// Unlock and invoke the queue.
			wp.updates.updateLock = false;
			wp.updates.queueChecker();

			return false;
		});

		// Click handler for plugin updates in List Table view.
		$( '.plugin-update-tr .update-link' ).on( 'click', function( e ) {
			e.preventDefault();
			if ( wp.updates.shouldRequestFilesystemCredentials && ! wp.updates.updateLock ) {
				wp.updates.requestFilesystemCredentials();
			}
			var $row = $( e.target ).parents( '.plugin-update-tr' );
			wp.updates.updatePlugin( $row.data( 'plugin' ), $row.data( 'slug' ) );
		} );

		$( '#bulk-action-form' ).on( 'submit', function( e ) {
			var $checkbox, plugin, slug;

			if ( $( '#bulk-action-selector-top' ).val() == 'update-selected' ) {
				e.preventDefault();

				$( 'input[name="checked[]"]:checked' ).each( function( index, elem ) {
					$checkbox = $( elem );
					plugin = $checkbox.val();
					slug = $checkbox.parents( 'tr' ).prop( 'id' );

					wp.updates.updatePlugin( plugin, slug );

					$checkbox.attr( 'checked', false );
				} );
			}
		} );

		$( '.plugin-card .update-now' ).on( 'click', function( e ) {
			e.preventDefault();
			var $button = $( e.target );
			wp.updates.updatePlugin( $button.data( 'plugin' ), $button.data( 'slug' ) );
		} );

	} );

	$( window ).on( 'message', function( e ) {
		var event = e.originalEvent,
			message,
			loc = document.location,
			expectedOrigin = loc.protocol + '//' + loc.hostname;

		if ( event.origin !== expectedOrigin ) {
			return;
		}

		message = $.parseJSON( event.data );

		if ( typeof message.action === 'undefined' || message.action !== 'decrementUpdateCount' ) {
			return;
		}

		wp.updates.decrementCount( message.upgradeType );

	} );

})( jQuery, window.wp, window.pagenow, window.ajaxurl );
