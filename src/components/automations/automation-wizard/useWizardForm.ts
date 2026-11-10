"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  CreateAutomationSchema,
  type CreateAutomationInput,
} from "@/models/automation.schema";
import {
  createAutomation,
  updateAutomation,
} from "@/actions/automation.actions";
import { toastSuccess, toastError } from "@/lib/toast";
import type { AutomationWithResume, JobBoard } from "@/models/automation.model";
import { isCzechJobBoard } from "@/models/automation.model";
import {
  EMPTY_ATS,
  EMPTY_JOBSCZ,
  EMPTY_STARTUPJOBS,
  STEPS,
  parseEditSourceConfig,
  type SearchConfigValue,
  type SourceKey,
} from "./wizardConfig";

interface UseWizardFormArgs {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  automations: AutomationWithResume[];
  onSuccess: () => void;
  editAutomation?: AutomationWithResume | null;
}

export function useWizardForm({
  open,
  onOpenChange,
  automations,
  onSuccess,
  editAutomation,
}: UseWizardFormArgs) {
  const [step, setStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<CreateAutomationInput>({
    resolver: zodResolver(CreateAutomationSchema),
    mode: "onChange",
    defaultValues: {
      name: editAutomation?.name ?? "",
      jobBoard: (editAutomation?.jobBoard as JobBoard) ?? "greenhouse",
      keywords: editAutomation?.keywords ?? "",
      location: editAutomation?.location ?? "",
      sourceConfig: parseEditSourceConfig(editAutomation?.sourceConfig),
      resumeId: editAutomation?.resumeId ?? "",
      matchThreshold: editAutomation?.matchThreshold ?? 80,
      scheduleHour: editAutomation?.scheduleHour ?? 8,
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        name: editAutomation?.name ?? "",
        jobBoard: (editAutomation?.jobBoard as JobBoard) ?? "greenhouse",
        keywords: editAutomation?.keywords ?? "",
        location: editAutomation?.location ?? "",
        sourceConfig: parseEditSourceConfig(editAutomation?.sourceConfig),
        resumeId: editAutomation?.resumeId ?? "",
        matchThreshold: editAutomation?.matchThreshold ?? 80,
        scheduleHour: editAutomation?.scheduleHour ?? 8,
      });
      setStep(0);
    }
  }, [open, editAutomation, form]);

  const formValues = form.watch();

  // Czech job boards have a ready-to-run personal-search preset. Persist it into
  // the actual form state as soon as the source is selected; otherwise the UI
  // would show the preset while schema validation still saw no sourceConfig.
  useEffect(() => {
    if (
      isCzechJobBoard(formValues.jobBoard) &&
      !form.getValues("sourceConfig")?.[formValues.jobBoard]
    ) {
      form.setValue(
        "sourceConfig",
        {
          ...form.getValues("sourceConfig"),
          [formValues.jobBoard]: formValues.jobBoard === "startupjobs.cz" ? EMPTY_STARTUPJOBS : EMPTY_JOBSCZ,
        },
        { shouldValidate: true },
      );
    }
  }, [form, formValues.jobBoard]);

  const onSubmit = async (data: CreateAutomationInput) => {
    setIsSubmitting(true);
    try {
      const result = editAutomation
        ? await updateAutomation(editAutomation.id, data)
        : await createAutomation(data);

      if (result.success) {
        toastSuccess(
          editAutomation
            ? "Your automation has been updated successfully."
            : "Your automation has been created and will run at the scheduled time.",
          editAutomation ? "Automation updated" : "Automation created",
        );
        form.reset();
        setStep(0);
        onOpenChange(false);
        onSuccess();
      } else {
        toastError(result.message || "Something went wrong");
      }
    } catch (error) {
      toastError("Failed to save automation");
    } finally {
      setIsSubmitting(false);
    }
  };

  const sourceKey: SourceKey = formValues.jobBoard;
  const sourceConfigValue: SearchConfigValue =
    formValues.sourceConfig?.[sourceKey] ??
    (sourceKey === "startupjobs.cz" ? EMPTY_STARTUPJOBS : sourceKey === "jobs.cz" ? EMPTY_JOBSCZ : EMPTY_ATS);

  const canGoNext = () => {
    switch (step) {
      case 0:
        return (formValues.name?.trim().length ?? 0) > 0;
      case 1:
        return isCzechJobBoard(sourceKey)
          ? ("queries" in sourceConfigValue && sourceConfigValue.queries.length > 0)
          : ("companies" in sourceConfigValue && sourceConfigValue.companies.length > 0);
      case 2:
        return (formValues.resumeId?.length ?? 0) > 0;
      case 3:
      case 4:
        return true;
      default:
        return false;
    }
  };

  // Hours already claimed by the user's other automations. Only one automation
  // may run per hourly slot, so the schedule step rejects a taken hour.
  const takenHours = new Set(
    automations
      .filter((a) => a.id !== editAutomation?.id)
      .map((a) => a.scheduleHour),
  );

  const nextStep = () => {
    if (step === 4 && takenHours.has(formValues.scheduleHour)) {
      form.setError("scheduleHour", {
        message: `Another automation already runs at ${(
          formValues.scheduleHour ?? 8
        )
          .toString()
          .padStart(2, "0")}:00. Please choose a different time.`,
      });
      return;
    }
    if (step < STEPS.length - 1) {
      setStep(step + 1);
    }
  };

  const prevStep = () => {
    if (step > 0) {
      setStep(step - 1);
    }
  };

  const handleClose = () => {
    form.reset();
    setStep(0);
    onOpenChange(false);
  };

  return {
    form,
    formValues,
    step,
    isSubmitting,
    sourceKey,
    sourceConfigValue,
    takenHours,
    canGoNext,
    nextStep,
    prevStep,
    handleClose,
    onSubmit,
  };
}
