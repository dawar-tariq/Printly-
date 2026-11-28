package io.github.dawartariq.printly.owner.nativeapp

import org.junit.Assert.assertEquals
import org.junit.Test

class NotificationPermissionPolicyTest {
    @Test fun firstOpenRequestsOnlyAnUnresolvedAndroid13OrLaterPermission() {
        assertEquals(FirstOpenPermissionAction.REQUEST, firstOpenNotificationPermissionAction(true, 33, false, false))
        assertEquals(FirstOpenPermissionAction.REQUEST, firstOpenNotificationPermissionAction(true, 36, false, false))
        assertEquals(FirstOpenPermissionAction.MARK_HANDLED, firstOpenNotificationPermissionAction(true, 32, false, false))
        assertEquals(FirstOpenPermissionAction.MARK_HANDLED, firstOpenNotificationPermissionAction(true, 33, false, true))
    }

    @Test fun demoAndLaterOpensNeverAutomaticallyRequestAgain() {
        assertEquals(FirstOpenPermissionAction.SKIP, firstOpenNotificationPermissionAction(false, 36, false, false))
        assertEquals(FirstOpenPermissionAction.SKIP, firstOpenNotificationPermissionAction(true, 33, true, false))
        assertEquals(FirstOpenPermissionAction.SKIP, firstOpenNotificationPermissionAction(true, 33, true, true))
    }
}
