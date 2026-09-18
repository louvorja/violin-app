<template>
  <LjDialog
    :model-value="!!device"
    size="sm"
    :persistent="isPending"
    :icon="ICONS.UI.MONITORS"
    :title="
      isPending
        ? $t('options.transmission.permissions_title')
        : $t('options.transmission.edit_device')
    "
    @update:model-value="onDialogClose"
  >
    <template v-if="displayDevice">
      <div class="dpd-header">
        <div class="dpd-device-info">
          <LjIcon :icon="ICONS.UI.MONITORS" :size="24" />
          <div>
            <div class="dpd-device-name">{{ displayDevice.name }}</div>
            <div class="dpd-device-platform">
              {{ $t("options.transmission.device_platform_label") }}:
              {{ $t(`options.transmission.platform_${displayDevice.platform}`) }}
              <template v-if="displayDevice.model">· {{ displayDevice.model }}</template>
            </div>
          </div>
        </div>
      </div>

      <LjDivider />

      <div class="dpd-name-field">
        <label class="dpd-label">{{ $t("options.transmission.device_name") }}</label>
        <LjInput v-model="editName" size="sm" :placeholder="displayDevice.name" />
      </div>

      <div class="dpd-permissions">
        <div class="dpd-permissions-header">
          <label class="dpd-label">{{ $t("options.transmission.device_permissions") }}</label>
          <LjButton size="sm" variant="ghost" @click="toggleAllPermissions">
            {{
              allSelected
                ? $t("options.transmission.deselect_all")
                : $t("options.transmission.select_all")
            }}
          </LjButton>
        </div>
        <div v-for="perm in permissions" :key="perm" class="dpd-perm-row">
          <LjCheckbox
            :model-value="editPermissions.includes(perm)"
            :label="$t(DEVICE_PERMISSION_LABELS[perm])"
            @update:model-value="togglePermission(perm)"
          />
        </div>
      </div>
    </template>

    <template #footer>
      <LjButton
        v-if="!isPending"
        size="sm"
        :icon="ICONS.ACTIONS.CANCEL"
        variant="ghost"
        @click="onDialogClose"
      >
        {{ $t("alert.cancel") }}
      </LjButton>
      <LjButton
        v-if="isPending"
        :icon="isPending ? ICONS.ACTIONS.REJECT : ICONS.ACTIONS.DELETE"
        size="sm"
        variant="danger"
        @click="reject"
      >
        {{ $t("options.transmission.reject_device") }}
      </LjButton>
      <LjButton v-else size="sm" :icon="ICONS.ACTIONS.DELETE" variant="danger" @click="reject">
        {{ $t("actions.delete") }}
      </LjButton>
      <LjButton
        size="sm"
        variant="primary"
        :icon="isPending ? ICONS.ACTIONS.APROVE : ICONS.ACTIONS.SAVE"
        @click="save"
      >
        {{ isPending ? $t("options.transmission.approve_device") : $t("actions.save") }}
      </LjButton>
    </template>
  </LjDialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { LjButton, LjCheckbox, LjDialog, LjDivider, LjIcon, LjInput } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import type { Device, DevicePermission } from "@/types/Device";
import { DEVICE_PERMISSIONS, DEVICE_PERMISSION_LABELS } from "@/types/Device";

const props = defineProps<{
  device: Device | null;
  isPending?: boolean;
}>();

const emit = defineEmits<{
  save: [id: string, name: string, permissions: DevicePermission[]];
  reject: [id: string];
  close: [];
}>();

const permissions = DEVICE_PERMISSIONS.filter((p) => p !== "root");

const editName = ref("");
const editPermissions = ref<DevicePermission[]>([]);

const displayDevice = ref<Device | null>(null);

watch(
  () => props.device,
  (d) => {
    if (d) {
      displayDevice.value = d;
      editName.value = d.name;
      editPermissions.value = [...d.permissions];
    }
  },
  { immediate: true }
);

function onDialogClose() {
  emit("close");
  setTimeout(() => {
    displayDevice.value = null;
  }, 250);
}

const allSelected = computed(() => permissions.every((p) => editPermissions.value.includes(p)));

function toggleAllPermissions() {
  editPermissions.value = allSelected.value ? [] : [...permissions];
}

function togglePermission(perm: DevicePermission) {
  const idx = editPermissions.value.indexOf(perm);
  if (idx >= 0) {
    editPermissions.value = editPermissions.value.filter((p) => p !== perm);
  } else {
    editPermissions.value = [...editPermissions.value, perm];
  }
}

function save() {
  if (!displayDevice.value) return;
  emit("save", displayDevice.value.id, editName.value, editPermissions.value);
}

function reject() {
  if (!displayDevice.value) return;
  emit("reject", displayDevice.value.id);
}
</script>

<style scoped>
.dpd-header {
  padding: var(--lj-space-3) 0;
}

.dpd-device-info {
  display: flex;
  align-items: center;
  gap: var(--lj-space-3);
}

.dpd-device-name {
  font-weight: var(--lj-weight-medium);
  font-size: var(--lj-text-sm);
}

.dpd-device-platform {
  font-size: var(--lj-text-xs);
  color: var(--lj-text-subtle);
  text-transform: uppercase;
}

.dpd-name-field {
  padding: var(--lj-space-3) 0;
}

.dpd-label {
  display: block;
  font-size: var(--lj-text-xs);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--lj-text-subtle);
  margin-bottom: var(--lj-space-2);
}

.dpd-permissions {
  padding: var(--lj-space-3) 0;
}

.dpd-permissions-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--lj-space-2);
}

.dpd-permissions-header .dpd-label {
  margin-bottom: 0;
}

.dpd-perm-row {
  padding: var(--lj-space-1) 0;
}
</style>
