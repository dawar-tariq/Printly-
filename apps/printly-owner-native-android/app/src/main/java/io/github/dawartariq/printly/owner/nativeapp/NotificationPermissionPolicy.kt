package io.github.dawartariq.printly.owner.nativeapp

internal const val FIRST_OPEN_PERMISSION_PREFERENCES = "native_notification_permission_prompt"
internal const val FIRST_OPEN_PERMISSION_HANDLED = "first_open_handled"

internal enum class FirstOpenPermissionAction { SKIP, MARK_HANDLED, REQUEST }

/** Android 13+ has a runtime notification permission. This is deliberately
 * separate from Firebase registration and the signed-in shop user's opt-in. */
internal fun firstOpenNotificationPermissionAction(
    pushAvailable: Boolean,
    androidApi: Int,
    alreadyHandled: Boolean,
    permissionGranted: Boolean,
): FirstOpenPermissionAction = when {
    !pushAvailable || alreadyHandled -> FirstOpenPermissionAction.SKIP
    androidApi < 33 || permissionGranted -> FirstOpenPermissionAction.MARK_HANDLED
    else -> FirstOpenPermissionAction.REQUEST
}
