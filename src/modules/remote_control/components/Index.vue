<template>
  <ModuleContainer ref="moduleContainer" :manifest="manifest">
    <div class="rcm-panel">
      <p class="rcm-info">{{ t("info_module") }}</p>

      <LjField layout="column" :label="t('labels.ip')" :hint="t('messages.get_ip')">
        <LjInput v-model="url" :disabled="loading || is_connected" :icon="ICONS.UI.IP_NETWORK">
          <template #suffix>
            <LjSpinner v-if="loading" class="rcm-busy" />
          </template>
        </LjInput>
      </LjField>

      <LjField layout="column" :label="t('labels.token')">
        <LjInput v-model="token" :disabled="loading || is_connected" :icon="ICONS.UI.CODE_BRACES">
          <template #suffix>
            <LjSpinner v-if="loading" class="rcm-busy" />
          </template>
        </LjInput>
      </LjField>

      <div class="rcm-actions">
        <LjButton @click="test">{{ t("labels.test_connection") }}</LjButton>
        <LjButton v-if="!is_connected" variant="primary" @click="connect">
          {{ t("labels.connect") }}
        </LjButton>
        <LjButton v-else variant="danger" @click="disonnect">
          {{ t("labels.disconnect") }}
        </LjButton>
      </div>
    </div>
  </ModuleContainer>
</template>

<script setup lang="ts">
import { LjButton, LjField, LjInput, LjSpinner } from "@/components/ui";
import { ICONS } from "@/config/Icons";
import { ref, computed, onMounted } from "vue";
import { module as manifest } from "../manifest";
import ModuleContainer from "@/components/ModuleContainer.vue";
import $userdata from "@/helpers/UserData";
import $alert from "@/helpers/Alert";

interface PingResponse {
  status?: string;
  app?: string;
  code?: string;
}

interface TestResult {
  message: string;
  error?: string | number;
  status: boolean;
  data?: PingResponse;
  app?: string;
  invalid_url?: string;
}

const moduleContainer = ref<{ t(key: string): string } | null>(null);
const t = (key: string): string => moduleContainer.value?.t(key) || key;

const url = ref<string>("");
const token = ref<string>("");
const loading = ref<boolean>(false);

const is_connected = computed<boolean>(() => {
  return !!$userdata.get("remote.is_connected");
});

function getUrl(input: string): string {
  let u = input.trim().replace(/\s+/g, "").replace(/\\/g, "/").replace(/\/+$/, "");

  if (!/^https?:\/\//i.test(u)) {
    u = "http://" + u;
  }

  if (u == "http://") {
    u = "";
  }

  return u;
}

async function testUrl(url: string): Promise<TestResult> {
  if (!url || url == "http://" || url == "https://") {
    return {
      message: "modules.remote_control.messages.url_not_provided",
      error: "",
      status: false,
    };
  }

  try {
    const response = await fetch(url + "/api/ping?token=" + token.value, {
      method: "GET",
      mode: "cors",
    });

    if (!response.ok) {
      return {
        message: "modules.remote_control.messages.url_not_provided",
        error: response.status,
        status: false,
      };
    }

    const data: PingResponse = await response.json();

    if (data.status != "ok") {
      return {
        message:
          data.code == "INVALID_TOKEN"
            ? "modules.remote_control.messages.invalid_token"
            : "modules.remote_control.messages.error",
        error: data.code,
        status: false,
      };
    }
    return {
      message: "modules.remote_control.messages.success",
      data: data,
      status: true,
    };
  } catch (error) {
    return {
      message: "modules.remote_control.messages.failed_to_connect",
      error: error instanceof Error ? error.message : String(error),
      status: false,
    };
  }
}

async function test(): Promise<boolean> {
  url.value = getUrl(url.value);

  loading.value = true;
  const ret = await testUrl(url.value);
  loading.value = false;

  if (!ret.status) {
    $alert.error({
      text: ret.message,
      error: ret.error,
    });
    return false;
  }

  // @ts-ignore — preserva lógica original de comparação
  if (!ret.status == "ok" && !ret.app == "LouvorJA") {
    $alert.error({
      text: ret.invalid_url,
    });
    return false;
  }

  $alert.info({
    text: "modules.remote_control.messages.success",
  });

  return true;
}

async function connect(): Promise<void> {
  $userdata.set("remote.url", getUrl(url.value));
  $userdata.set("remote.token", token.value);

  if (!(await test())) {
    return;
  }

  $userdata.set("remote.is_connected", true);
}

function disonnect(): void {
  $userdata.set("remote.is_connected", false);
}

onMounted(() => {
  url.value = $userdata.get("remote.url") as string;
  token.value = $userdata.get("remote.token") as string;
});
</script>

<style scoped>
/* Sem recuo lateral: o formulário encosta na borda do módulo, como no
   `px-0` que ele tinha — o ModuleContainer não reserva margem própria. */
.rcm-panel {
  padding: var(--lj-space-6) 0;
}

.rcm-info {
  margin: 0 0 var(--lj-space-6);
  color: var(--lj-text-muted);
  font-size: var(--lj-text-sm);
  line-height: 1.5;
}

/* O indicador de "testando" mora no sufixo do campo: o primitivo não tem
   estado de carregamento próprio, e sem ele o botão fica mudo na espera. */
.rcm-busy {
  color: var(--lj-warning);
}

.rcm-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--lj-space-4);
}
</style>
