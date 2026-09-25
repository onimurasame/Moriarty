#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "MoriartyActor.generated.h"

UCLASS(Blueprintable)
class MORIARTY_API AMoriartyActor : public AActor
{
	GENERATED_BODY()
	
public:	
	AMoriartyActor();

	// The UUID assigned by the Moriarty Causal State Graph engine
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Moriarty")
	FString MoriartyId;

	// The ontology type (agent, npc, object)
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Moriarty")
	FString MoriartyType;

	// Entity name as defined in the TS simulation
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Moriarty")
	FString EntityName;

protected:
	virtual void BeginPlay() override;

public:	
	virtual void Tick(float DeltaTime) override;

	// Called via MCP when the state delta dictates a change
	UFUNCTION(BlueprintCallable, Category = "Moriarty")
	virtual void ApplyStateDelta(const FString& JsonChanges);
};
