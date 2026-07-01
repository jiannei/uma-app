<script setup lang="ts">
// src/bubble/SuggestionList.vue — list of permission suggestions
// (uma-pet: "Always allow X in Y/", "Auto-accept edits", etc.).
// Each suggestion is a button; click emits the chosen entry back up.
// The hover→arrow affordance lives in bubble.css .btn-suggestion.
import type { PermissionUpdateEntry } from "@/types/permission";
import { suggestionLabel } from "./suggestion-label";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

defineProps<{
  suggestions: PermissionUpdateEntry[];
}>();

const emit = defineEmits<{
  (e: "pick", s: PermissionUpdateEntry): void;
}>();
</script>

<template>
  <div v-if="suggestions.length > 0" class="suggestions">
    <button
      v-for="(s, i) in suggestions"
      :key="i"
      class="btn-suggestion"
      @click="emit('pick', s)"
    >
      {{ suggestionLabel(s, t) }}
    </button>
  </div>
</template>